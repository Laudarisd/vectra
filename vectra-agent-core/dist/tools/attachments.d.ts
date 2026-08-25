import { VectraDeepTool } from './contracts';
export interface VectraAttachmentRecord {
    name: string;
    kind?: string;
    mime?: string;
    text?: string;
}
/** Shared safe attachment tools for browser/server hosts. */
export declare function createAttachmentTools<TContext = unknown>(attachments: readonly VectraAttachmentRecord[]): VectraDeepTool<TContext>[];
//# sourceMappingURL=attachments.d.ts.map