import { z } from 'zod';
import { VectraDeepTool, VectraToolDefinition } from '../contracts';

const value=z.union([z.string(),z.number(),z.null()]);
const chartSchema=z.object({
  title:z.string().min(1).max(120),
  type:z.enum(['line','area','bar','scatter']),
  data:z.array(z.record(z.string(),value)).min(1).max(2000),
  xKey:z.string().min(1).max(80),
  series:z.array(z.object({key:z.string().min(1).max(80),label:z.string().max(80).optional(),color:z.string().regex(/^#[0-9a-f]{6}$/i).optional(),lineStyle:z.enum(['solid','dashed','dotted']).optional()})).min(1).max(12),
  xLabel:z.string().max(80).optional(),yLabel:z.string().max(80).optional(),source:z.string().max(300).optional(),
  width:z.number().int().min(320).max(2400).optional(),height:z.number().int().min(240).max(1600).optional()
});

export const VISUALIZATION_TOOL_DEFINITION:VectraToolDefinition={name:'create_visualization',displayName:'Create Visualization',description:'Create an interactive data-driven chart from verified structured values.',risk:'read',surface:'web'};

export function createVisualizationTool<TContext>(artifacts:Array<{name:string;mime:string;base64:string;view?:'image'|'chart';title?:string}>):VectraDeepTool<TContext>{
  return{name:'create_visualization',description:'Create an interactive line, area, bar, or scatter chart from verified structured data. Never invent values. Preserve requested title, pixel dimensions, colors, and solid/dashed/dotted line styles. Otherwise use a responsive 16:9 default. Use concise series names and include the source when known.',schema:chartSchema,execute:(input)=>{
    const spec=chartSchema.parse(input),name=`${spec.title.replace(/[^\w.-]+/g,'_').slice(0,60)||'chart'}.vectra-chart.json`;
    const artifact={name,mime:'application/vnd.vectra.chart+json',base64:Buffer.from(JSON.stringify(spec)).toString('base64'),view:'chart' as const,title:spec.title};
    const index=artifacts.findIndex(item=>item.name===name);if(index>=0)artifacts[index]=artifact;else artifacts.push(artifact);
    return `Created interactive ${spec.type} chart "${spec.title}" with ${spec.data.length} row(s) and ${spec.series.length} series.`;
  }};
}
