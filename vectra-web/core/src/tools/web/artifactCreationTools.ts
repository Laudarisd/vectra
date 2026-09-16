import { z } from 'zod';
import { VectraDeepTool, VectraToolDefinition } from '../contracts';

type Artifact={name:string;mime:string;base64:string;view?:'image'|'chart';title?:string;previewText?:string};
export interface ArtifactCreationOptions{
  createArtifact?:(kind:string,input:Record<string,unknown>)=>Promise<Artifact>;
  generateImage?:(input:Record<string,unknown>)=>Promise<Artifact>;
}
export const ARTIFACT_CREATION_DEFINITIONS:readonly VectraToolDefinition[]=[
  {name:'create_document',displayName:'Create Document',description:'Create a native PDF or DOCX document.',risk:'write',surface:'web'},
  {name:'create_spreadsheet',displayName:'Create Spreadsheet',description:'Create a native XLSX spreadsheet.',risk:'write',surface:'web'},
  {name:'create_presentation',displayName:'Create Presentation',description:'Create a native PPTX presentation.',risk:'write',surface:'web'},
  {name:'generate_image',displayName:'Generate Image',description:'Generate a real raster image with a configured image model.',risk:'network',surface:'web'}
];
const file=z.string().min(1).max(160);
export function createArtifactCreationTools<TContext>(artifacts:Artifact[],options?:ArtifactCreationOptions):VectraDeepTool<TContext>[] {
  const run=(kind:string,input:Record<string,unknown>,handler=options?.createArtifact)=>{if(!handler)throw new Error(`${kind} creation is unavailable in this host.`);return handler(kind,input).then(artifact=>{upsert(artifacts,artifact);return`Created ${artifact.name} in the requested native format.`})};
  return[
    {name:'create_document',description:'Create a polished native PDF or DOCX. Preserve the requested filename and format exactly.',schema:z.object({name:file.regex(/\.(pdf|docx)$/i),title:z.string().max(160).optional(),content:z.string().min(1)}),execute:input=>run('document',input)},
    {name:'create_spreadsheet',description:'Create a native XLSX workbook from structured rows. Do not use CSV when XLSX was requested.',schema:z.object({name:file.regex(/\.xlsx$/i),sheetName:z.string().min(1).max(31).optional(),columns:z.array(z.object({key:z.string().min(1),header:z.string().min(1)})).min(1).max(100),rows:z.array(z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()]))).max(10000)}),execute:input=>run('spreadsheet',input)},
    {name:'create_presentation',description:'Create a native PPTX deck with concise slide titles and body points.',schema:z.object({name:file.regex(/\.pptx$/i),title:z.string().max(160).optional(),slides:z.array(z.object({title:z.string().min(1).max(160),bullets:z.array(z.string().max(500)).max(12)})).min(1).max(60)}),execute:input=>run('presentation',input)},
    {name:'generate_image',description:'Generate a real PNG, JPEG, or WebP using an image-generation model. Use for realistic or polished artwork; use draw_image only for diagrams.',schema:z.object({name:file.regex(/\.(png|jpe?g|webp)$/i),prompt:z.string().min(10).max(4000),model:z.string().max(120).optional(),size:z.enum(['1024x1024','1536x1024','1024x1536']).optional(),quality:z.enum(['low','medium','high']).optional(),transparent:z.boolean().optional()}),execute:async input=>{if(!options?.generateImage)throw new Error('Real image generation is not configured for this provider.');const artifact=await options.generateImage(input);upsert(artifacts,artifact);return`Generated ${artifact.name} with the configured image model.`}}
  ];
}
function upsert(items:Artifact[],artifact:Artifact){const index=items.findIndex(item=>item.name===artifact.name);if(index>=0)items[index]=artifact;else items.push(artifact)}
