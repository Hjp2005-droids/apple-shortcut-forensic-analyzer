import base64
import json
import plistlib
import struct
import hashlib
import traceback
from cryptography import x509
from cryptography.hazmat.primitives import serialization
import aea

def response(status, payload):
    return {"statusCode": status, "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}, "body": json.dumps(payload, default=bytes_json)}

def bytes_json(value):
    if isinstance(value, bytes):
        return {"__type__": "bytes", "base64": base64.b64encode(value).decode("ascii"), "length": len(value)}
    if isinstance(value, plistlib.UID):
        return {"__type__": "UID", "value": value.data}
    raise TypeError(f"Not JSON serializable: {type(value).__name__}")

def find_embedded_bplist(archive):
    # Apple Archive wraps Shortcut.wflow as an entry. Find a binary plist and
    # validate its trailer-derived length before passing bytes to plistlib.
    marker = b"bplist00"
    start = 0
    while True:
        pos = archive.find(marker, start)
        if pos < 0:
            break
        start = pos + 1
        # Binary plist trailer: 6 reserved bytes, offset-size, ref-size,
        # object count, top object, offset-table offset.
        min_end = pos + 8 + 32
        for trailer_pos in range(min_end - 32, len(archive) - 31):
            trailer = archive[trailer_pos:trailer_pos + 32]
            offset_size = trailer[6]
            ref_size = trailer[7]
            if offset_size < 1 or offset_size > 8 or ref_size < 1 or ref_size > 8:
                continue
            num_objects = int.from_bytes(trailer[8:16], "big")
            offset_table_offset = int.from_bytes(trailer[24:32], "big")
            if num_objects < 1 or num_objects > 2_000_000:
                continue
            candidate_end = pos + offset_table_offset + num_objects * offset_size + 32
            if candidate_end != trailer_pos + 32 or candidate_end > len(archive):
                continue
            candidate = archive[pos:candidate_end]
            try:
                obj = plistlib.loads(candidate)
                if isinstance(obj, dict) and "WFWorkflowActions" in obj:
                    return candidate, obj
            except Exception:
                pass
    raise ValueError("AEA was decoded, but a valid Shortcut.wflow binary plist could not be located inside the Apple Archive. The archive layout may differ from the supported sample format.")

def decode_shortcut(data):
    if len(data) < 12 or data[:4] != b"AEA1":
        raise ValueError("Input is not a signed AEA1 .shortcut container.")
    profile, auth_size = struct.unpack_from("<II", data, 4)
    if profile != 0:
        raise ValueError(f"Unsupported AEA profile {profile}; signed Shortcuts normally use profile 0.")
    auth_end = 12 + auth_size
    if auth_end > len(data):
        raise ValueError("AEA authentication-data length exceeds the file size.")
    auth = plistlib.loads(data[12:auth_end])
    chain = auth.get("SigningCertificateChain") if isinstance(auth, dict) else None
    if not chain or not isinstance(chain, list):
        raise ValueError("Could not find SigningCertificateChain in the AEA authentication plist.")
    cert = x509.load_der_x509_certificate(chain[0])
    pub = cert.public_key()
    if not hasattr(pub, "public_bytes"):
        raise ValueError("Unsupported signing certificate public key.")
    pub_bytes = pub.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    # python-aea expects the public key in PEM form (the same form used by its documented examples).
    # It validates the signature and decompresses the AEA payload.
    try:
        archive = aea.decode(data, signature_pub=pub_bytes)
    except Exception as exc:
        raise ValueError(f"AEA payload decode/signature verification failed ({type(exc).__name__}): {exc}") from exc
    wflow_bytes, workflow = find_embedded_bplist(archive)
    return {
        "workflow": workflow,
        "archiveMagic": archive[:4].decode("ascii", errors="replace"),
        "workflowBytes": len(wflow_bytes),
        "profile": profile,
        "signingSubject": cert.subject.rfc4514_string(),
        "signingIssuer": cert.issuer.rfc4514_string(),
        "signatureVerification": "python-aea accepted the signature using the public key embedded in the file; this is not a full Apple certificate trust-chain validation."
    }

def handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 204, "headers": {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type"}, "body": ""}
    try:
        body = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            body = base64.b64decode(body).decode("utf-8")
        req = json.loads(body)
        encoded = req.get("fileBase64")
        filename = req.get("filename", "uploaded.shortcut")
        if not encoded:
            return response(400, {"error": "Missing fileBase64 field."})
        data = base64.b64decode(encoded, validate=True)
        if len(data) > 8 * 1024 * 1024:
            return response(413, {"error": "File exceeds the 8 MiB limit."})
        digest = hashlib.sha256(data).hexdigest()
        if data[:4] != b"AEA1":
            # Permit decoded plist/XML/JSON as well.
            if data.startswith(b"bplist00"):
                workflow = plistlib.loads(data)
            else:
                try:
                    workflow = json.loads(data.decode("utf-8"))
                except Exception:
                    workflow = plistlib.loads(data)
            if isinstance(workflow, list):
                workflow = {"WFWorkflowActions": workflow}
            if isinstance(workflow, dict) and "actions" in workflow and "WFWorkflowActions" not in workflow:
                workflow["WFWorkflowActions"] = workflow["actions"]
            if not isinstance(workflow, dict) or not isinstance(workflow.get("WFWorkflowActions"), list):
                return response(422, {"error": "Decoded input did not contain a WFWorkflowActions array."})
            decoded = {"workflow": workflow, "profile": None, "signatureVerification": "Not applicable to a decoded plist/JSON import."}
        else:
            decoded = decode_shortcut(data)
        decoded["file"] = {"name": filename, "size": len(data), "sha256": digest, "magic": data[:4].decode("ascii", errors="replace")}
        return response(200, decoded)
    except Exception as exc:
        return response(422, {"error": str(exc), "errorType": type(exc).__name__, "diagnostic": "The serverless decoder could not complete the extraction. No partial action transcription is claimed."})
