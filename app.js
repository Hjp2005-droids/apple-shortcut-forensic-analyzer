const $=id=>document.getElementById(id);
let selected=null, result=null;
const knownNames={
"is.workflow.actions.gettext":"Text","is.workflow.actions.ask":"Ask for Input","is.workflow.actions.choosefrommenu":"Choose from Menu",
"is.workflow.actions.conditional":"If","is.workflow.actions.repeat.count":"Repeat","is.workflow.actions.repeat.each":"Repeat with Each",
"is.workflow.actions.getfile":"Get File","is.workflow.actions.savefile":"Save File","is.workflow.actions.documentpicker.open":"Select File",
"is.workflow.actions.setvariable":"Set Variable","is.workflow.actions.getvariable":"Get Variable","is.workflow.actions.comment":"Comment",
"is.workflow.actions.showresult":"Show Result","is.workflow.actions.notification":"Show Notification","is.workflow.actions.openurl":"Open URLs",
"is.workflow.actions.getcontentsOfurl":"Get Contents of URL","is.workflow.actions.dictionary":"Dictionary","is.workflow.actions.exit":"Stop and Output"
};
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function hex(bytes,n=16){return [...bytes.slice(0,n)].map(b=>b.toString(16).padStart(2,'0')).join(' ')}
function download(name,content,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function pretty(v){return JSON.stringify(v,(k,x)=>typeof x==="bigint"?String(x):x,2)}
function actionName(a){const id=a.WFWorkflowActionIdentifier||a.actionIdentifier||a.identifier||"Unknown action";return {id,name:knownNames[id]||id.split('.').pop().replace(/([a-z])([A-Z])/g,'$1 $2'),params:a.WFWorkflowActionParameters||a.parameters||{}}}
function extractWorkflow(data){
 if(Array.isArray(data)) return {WFWorkflowActions:data};
 if(data&&typeof data==="object"){
   if(data.WFWorkflowActions||data.workflow?.WFWorkflowActions) return data.workflow||data;
   if(data.actions&&Array.isArray(data.actions)) return {WFWorkflowActions:data.actions};
 }
 return null;
}
function xmlToWorkflow(xml){
 // Minimal XML plist reader for common plist structures. Binary plists need a proper decoder/export.
 const doc=new DOMParser().parseFromString(xml,"application/xml");
 if(doc.querySelector("parsererror")) throw Error("This does not appear to be valid XML.");
 const root=doc.querySelector("plist > dict, plist > array"); if(!root) throw Error("No plist dictionary/array was found.");
 function parse(el){const t=el.tagName;if(t==="dict"){const out={};let kids=[...el.children];for(let i=0;i<kids.length;i+=2){let key=kids[i],val=kids[i+1];if(key&&val)out[key.textContent]=parse(val)}return out}
 if(t==="array")return [...el.children].map(parse);if(t==="string"||t==="date"||t==="data")return el.textContent;
 if(t==="integer"||t==="real")return Number(el.textContent);if(t==="true")return true;if(t==="false")return false;return el.textContent}
 return parse(root);
}
function tokenize(v){
 if(!v||typeof v!=="object")return [];
 const out=[];function walk(x,path){if(!x||typeof x!=="object")return;
 if(x.WFSerializationType==="WFTextTokenAttachment"||x.WFSerializationType==="WFTextTokenString")out.push({path,type:x.WFSerializationType,value:x.Value});
 for(const [k,val] of Object.entries(x))if(k!=="Value")walk(val,path+"."+k);
 }walk(v,"params");return out;
}
function explain(id){const map={
"is.workflow.actions.gettext":"Provides a literal text value to later actions.",
"is.workflow.actions.ask":"Prompts the user for input.",
"is.workflow.actions.choosefrommenu":"Presents a menu and routes execution through the selected menu branch.",
"is.workflow.actions.conditional":"Evaluates a condition and runs the matching branch.",
"is.workflow.actions.repeat.count":"Repeats a block a specified number of times.",
"is.workflow.actions.repeat.each":"Runs a block for each item in a collection.",
"is.workflow.actions.setvariable":"Stores a value under a named variable.",
"is.workflow.actions.getvariable":"Retrieves a previously stored variable.",
"is.workflow.actions.savefile":"Saves content to a file or folder.",
"is.workflow.actions.getfile":"Retrieves a file.",
"is.workflow.actions.openurl":"Opens a URL."
};return map[id]||"No built-in explanation is assigned to this identifier. The identifier and parameters below are the source of truth."}
function render(wf){
 const acts=wf.WFWorkflowActions||[];const title=wf.WFWorkflowName||selected.name.replace(/\.[^.]+$/,"");
 const meta={name:title,actionCount:acts.length,workflowKeys:Object.keys(wf),clientVersion:wf.WFWorkflowClientVersion??null,minimumClientVersion:wf.WFWorkflowMinimumClientVersion??null};
 const md=[`# ${title}`,``,`## File and workflow summary`,``,`- File: \`${selected.name}\``,`- Size: ${selected.size.toLocaleString()} bytes`,`- SHA-256: \`${result.sha256}\``,`- Container signature: \`${result.magic}\``,`- Workflow action count: ${acts.length}`,``,`## Ordered action transcription`,``,`> Action display names are mapped where known. Other names are derived from the identifier; verify them in Shortcuts if exact localized UI wording is required.`,` `];
 let html=`<h2>${esc(title)}</h2><p class="muted">${acts.length} actions found in the workflow array. Raw parameter dictionaries are preserved below.</p>`;
 acts.forEach((a,i)=>{const x=actionName(a), raw=pretty(a.WFWorkflowActionParameters||a.parameters||{});const tokens=tokenize(x.params);
 html+=`<article class="action"><h3>${i+1}. ${esc(x.name)}</h3><span class="pill">${esc(x.id)}</span><p>${esc(explain(x.id))}</p>${tokens.length?`<p>${tokens.map(t=>`<span class="pill">${esc(t.type)}</span>`).join(" ")}</p>`:""}<details><summary>Original parameter dictionary</summary><pre>${esc(raw)}</pre></details><details><summary>Complete action dictionary</summary><pre>${esc(pretty(a))}</pre></details></article>`;
 md.push(`### Action ${i+1} — ${x.name}`,``,`- **Action identifier:** \`${x.id}\``,`- **Explanation:** ${explain(x.id)}`,``,`**Original parameter dictionary**`,``,`\`\`\`json`,raw,`\`\`\``,``,`**Complete action dictionary**`,``,`\`\`\`json`,pretty(a),`\`\`\``,``);
 });
 md.push("## Workflow metadata","","```json",pretty(Object.fromEntries(Object.entries(wf).filter(([k])=>k!=="WFWorkflowActions"))),"```");
 $("summary").innerHTML=`<div class="stat"><b>${esc(selected.name)}</b><span>File</span></div><div class="stat"><b>${selected.size.toLocaleString()}</b><span>Bytes</span></div><div class="stat"><b>${acts.length}</b><span>Actions</span></div><div class="stat"><b>${esc(result.magic)}</b><span>Signature</span></div>`;
 $("report").innerHTML=html;$("raw").textContent=pretty(wf);$("metadata").textContent=pretty(meta);result.markdown=md.join("\n");result.workflow=wf;result.json=pretty(wf);$("results").hidden=false;
}
async function sha256(buf){const d=await crypto.subtle.digest("SHA-256",buf);return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function analyze(){
 if(!selected)return;
 $("status").textContent="Inspecting file signature and contents…";$("results").hidden=true;
 try{
  const buf=await selected.arrayBuffer(), bytes=new Uint8Array(buf), magic=new TextDecoder().decode(bytes.slice(0,4));
  result={magic,sha256:await sha256(buf),size:bytes.length,head:hex(bytes,24)};
  let parsed=null, format="";
  if(magic==="AEA1"){
    const profile=new DataView(buf).getUint32(4,true), authLength=new DataView(buf).getUint32(8,true);
    $("status").innerHTML=`<div class="warning"><strong>Signed Apple Shortcut container detected (AEA1).</strong><br>Size: ${bytes.length.toLocaleString()} bytes · SHA-256: <code>${result.sha256}</code><br>Profile: ${profile} · Auth-data length: ${authLength} bytes.<br><br>This Netlify starter can identify and fingerprint this container, but it does not yet decode the signed AEA → Apple Archive → binary plist layers. It will not pretend the workflow has been extracted. Use the included raw plist/XML/JSON import path for decoded exports, or add a verified AEA/Apple Archive decoder backend to enable full signed-file extraction.</div>`;
    $("summary").innerHTML=`<div class="stat"><b>AEA1</b><span>Container</span></div><div class="stat"><b>${bytes.length.toLocaleString()}</b><span>Bytes</span></div><div class="stat"><b>${profile}</b><span>AEA profile</span></div><div class="stat"><b>Not decoded</b><span>Workflow payload</span></div>`;
    $("report").innerHTML=`<h2>Container diagnosis</h2><p>The file begins with <code>AEA1</code>, which identifies an Apple Encrypted Archive wrapper used by modern signed Shortcuts exports. The embedded workflow is not a plain plist at byte zero.</p><p>Profile <b>${profile}</b>; authentication metadata length <b>${authLength}</b> bytes. This is a forensic identification only, not a successful workflow extraction.</p><p>To enable full extraction for signed files, the backend must implement signature verification/decompression and Apple Archive entry extraction, then parse <code>Shortcut.wflow</code> as a binary plist.</p><details><summary>Header bytes</summary><pre>${esc(result.head)}</pre></details>`;
    $("raw").textContent="No workflow payload extracted. Header bytes: "+result.head;$("metadata").textContent=pretty(result);result.markdown=`# ${selected.name}\n\n## Forensic status\n\n- Result: **Container identified; workflow not decoded**\n- Size: ${bytes.length} bytes\n- SHA-256: ${result.sha256}\n- Magic: ${magic}\n- AEA profile: ${profile}\n- Authentication data length: ${authLength} bytes\n- Header bytes: ${result.head}\n\nThe file is a signed AEA container. No action count or action transcription is claimed because the inner Apple Archive and binary plist were not extracted.\n`;
    $("results").hidden=false;return;
  }
  const text=new TextDecoder().decode(bytes);
  if(magic==="bplist") throw Error("Binary plist detected, but this starter does not include a binary-plist decoder. Export the workflow as XML plist or JSON and import that export.");
  try{if(text.trim().startsWith("{")||text.trim().startsWith("[")){parsed=JSON.parse(text);format="JSON"}else if(text.trim().startsWith("<?xml")||text.trim().startsWith("<plist")){parsed=xmlToWorkflow(text);format="XML property list"}else throw Error("Unknown format. Expected JSON, XML plist, or an AEA1 signed .shortcut container.");}catch(e){throw e}
  const wf=extractWorkflow(parsed);if(!wf)throw Error(`Parsed ${format}, but could not find a WFWorkflowActions array or actions array.`);
  result.magic=magic==="bplist"?"bplist":magic;result.format=format;render(wf);$("status").textContent=`Parsed ${format} successfully. File fingerprint recorded.`;
 }catch(e){$("status").textContent="Analysis stopped: "+e.message}
}
$("file").addEventListener("change",e=>{selected=e.target.files[0]||null;$("analyze").disabled=!selected;$("status").textContent=selected?`${selected.name} selected (${selected.size.toLocaleString()} bytes).`:"Choose a file to begin."});
$("analyze").addEventListener("click",analyze);$("clear").addEventListener("click",()=>{selected=null;result=null;$("file").value="";$("analyze").disabled=true;$("results").hidden=true;$("status").textContent="Choose a file to begin."});
const drop=$("drop");for(const ev of ["dragenter","dragover"])drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add("drag")});for(const ev of ["dragleave","drop"])drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove("drag")});drop.addEventListener("drop",e=>{const f=e.dataTransfer.files[0];if(f){selected=f;$("file").files=e.dataTransfer.files;$("analyze").disabled=false;$("status").textContent=`${f.name} selected (${f.size.toLocaleString()} bytes).`}});
document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));["report","raw","metadata"].forEach(id=>$(id).hidden=id!==b.dataset.tab)}));
$("downloadMd").addEventListener("click",()=>result&&download(selected.name.replace(/\.[^.]+$/,"")+"_forensic_report.md",result.markdown||"# No report", "text/markdown"));
$("downloadJson").addEventListener("click",()=>result&&download(selected.name.replace(/\.[^.]+$/,"")+"_decoded.json",result.json||pretty(result),"application/json"));
