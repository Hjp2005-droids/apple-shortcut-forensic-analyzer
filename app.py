import json
import importlib.util
from pathlib import Path

from flask import Flask, jsonify, request

app = Flask(__name__)

DECODER_PATH = Path(__file__).parent / "netlify" / "functions" / "decode_shortcut.py"
spec = importlib.util.spec_from_file_location("shortcut_decoder", DECODER_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Could not load decoder module at {DECODER_PATH}")
decoder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(decoder)


@app.get("/")
def home():
    return jsonify({
        "service": "Shortcut Analyzer decoder API",
        "status": "running",
        "endpoints": {"health": "GET /health", "decode": "POST /decode"}
    })


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/decode")
def decode():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Expected a JSON request body."}), 400

    # Adapt the browser's JSON payload to the event shape expected by the
    # existing Netlify handler.
    event = {
        "httpMethod": "POST",
        "headers": {"content-type": "application/json"},
        "body": json.dumps(payload),
        "isBase64Encoded": False,
    }
    result = decoder.handler(event, None)
    status = result.get("statusCode", 500)
    body = result.get("body", "{}")
    try:
        body_json = json.loads(body) if isinstance(body, str) else body
    except Exception:
        body_json = {"error": str(body)}
    return jsonify(body_json), status


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
