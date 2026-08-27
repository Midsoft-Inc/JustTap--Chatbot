declare module 'pdf-parse' {
  interface PDFData {
    text: string;
    numpages?: number;
    numrender?: number;
    info?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
  function pdf(dataBuffer: Buffer): Promise<PDFData>;
  export default pdf;
}
