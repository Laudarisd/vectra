// Beginner guide: Handles e vi de nc e responsibilities for Vectra.
const CHILD_ASSET_SEPARATOR=' · ';
const CHILD_ASSET_PATTERN=/(?: · | Â· )(?:page \d+|embedded image \d+|visual OCR)/i;

export function attachmentRootName(name){
  return String(name||'').split(CHILD_ASSET_PATTERN)[0];
}

export function visualOcrEvidenceName(name){
  return `${name}${CHILD_ASSET_SEPARATOR}visual OCR`;
}

// Replace a document and all generated child assets as one logical upload.
export function mergeAttachmentSets(previous,incoming){
  const incomingRoots=new Set(incoming.map(file=>attachmentRootName(file.name)));
  return[...previous.filter(file=>!incomingRoots.has(attachmentRootName(file.name))),...incoming];
}

// Keep the system prompt compact while exposing the adaptive parse route.
export function attachmentManifest(attachments){
  if(!attachments.length)return'none';
  const groups=new Map();
  for(const file of attachments){
    const root=attachmentRootName(file.name);
    const group=groups.get(root)||{files:0,images:0,text:0,visualOcr:0,pendingVision:0};
    group.files++;
    if(file.mime?.startsWith('image/'))group.images++;
    group.text+=(file.text||'').length;
    if(/visual OCR$/i.test(file.name))group.visualOcr+=(file.text||'').length;
    if(file.ocrRequired)group.pendingVision++;
    groups.set(root,group);
  }
  return[...groups].map(([name,group])=>`${name}: parts=${group.files}, images=${group.images}, parsedText=${group.text} chars, visualOcr=${group.visualOcr} chars, pendingVision=${group.pendingVision}`).join('; ');
}

// Select text and images fairly across documents while respecting the prompt budget.
export function attachmentContextForPrompt(prompt,attachments,totalTextChars,maxImages){
  if(!attachments.length)return[];
  const lower=String(prompt||'').toLowerCase();
  const namedRoots=attachments.filter(file=>lower.includes(file.name.toLowerCase())).map(file=>attachmentRootName(file.name));
  const candidates=namedRoots.length?attachments.filter(file=>namedRoots.includes(attachmentRootName(file.name))):attachments;
  const documentCandidates=candidates.filter(file=>!file.mime?.startsWith('image/'));
  const textFiles=documentCandidates.filter(file=>(file.text||'').length>0);
  const perFile=Math.max(1000,Math.floor(totalTextChars/Math.max(1,textFiles.length)));
  const documents=documentCandidates.map(file=>{
    const text=/visual OCR$/i.test(file.name)?clipVisualOcrCoverage(file.text||'',perFile):clip(file.text||'',perFile);
    return{...file,text,...(text?{base64:''}:{})};
  });

  // Round-robin visual pages so one long PDF cannot crowd out other uploads.
  const imageGroups=new Map();
  for(const file of candidates.filter(file=>file.mime?.startsWith('image/'))){
    const root=attachmentRootName(file.name);
    if(!imageGroups.has(root))imageGroups.set(root,[]);
    imageGroups.get(root).push(file);
  }
  const images=[];
  let page=0;
  while(images.length<maxImages){
    let added=false;
    for(const group of imageGroups.values()){
      if(group[page]){
        images.push({...group[page],text:''});
        added=true;
        if(images.length>=maxImages)break;
      }
    }
    if(!added)break;
    page++;
  }
  return[...documents,...images];
}

// Expose parsed evidence to the Deep Agent filesystem without copying image bytes.
export function attachmentScratchFiles(attachments){
  const now=new Date().toISOString();
  const files={};
  for(const file of attachments){
    if(!(file.text||'').trim())continue;
    const safeName=file.name.replace(/[\\/]+/g,'_');
    files[`/${safeName}`]={content:clip(file.text,50000),mimeType:'text/plain',created_at:now,modified_at:now};
  }
  return files;
}

// Give every OCRed page some prompt space; full evidence remains readable by tool.
function clipVisualOcrCoverage(text,maxChars){
  if(text.length<=maxChars)return text;
  const matches=[...text.matchAll(/^\[VISUAL SOURCE: .+\]$/gm)];
  if(!matches.length)return clip(text,maxChars);
  const blocks=matches.map((match,index)=>text.slice(match.index,index+1<matches.length?matches[index+1].index:text.length).trim());
  const blockBudget=Math.max(160,Math.floor((maxChars-150)/blocks.length));
  const coverage=blocks.map(block=>clip(block,blockBudget));
  return `[COVERAGE PREVIEW: all ${blocks.length} visual sources are represented; use vectra_read_attachment for complete text.]\n\n${coverage.join('\n\n')}`.slice(0,maxChars);
}

function clip(text,maxChars){
  if(text.length<=maxChars)return text;
  const half=Math.max(1,Math.floor((maxChars-80)/2));
  return `${text.slice(0,half)}\n\n...[truncated ${text.length-half*2} chars]...\n\n${text.slice(-half)}`;
}
