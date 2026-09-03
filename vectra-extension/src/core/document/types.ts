// Beginner guide: Defines shared TypeScript data shapes so related modules agree on the same values.
/** Provider-neutral representation of one uploaded or derived document part. */
export interface VectraAttachmentRecord {
  name: string;
  kind?: string;
  mime?: string;
  text?: string;
  width?: number;
  height?: number;
  pageNumber?: number;
  pageClassification?: string;
  ocrRequired?: boolean;
}

export interface DocumentTableColumn {
  key: string;
  header: string;
}

export interface DocumentTableInput {
  title?: string;
  columns: DocumentTableColumn[];
  rows: Array<Record<string, unknown>>;
  matchKeys?: string[];
  sources?: string[];
}
