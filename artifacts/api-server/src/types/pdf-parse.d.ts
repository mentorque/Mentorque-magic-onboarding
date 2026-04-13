declare module 'pdf-parse' {
  interface PDFData {
    numpages: number;
    numrender: number;
    info: any;
    metadata: any;
    text: string;
    version: string;
  }

  interface Options {
    pagerender?: ((page: any) => string) | undefined;
    max?: number | undefined;
    verbosityLevel?: number | undefined;
  }

  function pdfParse(dataBuffer: Buffer, options?: Options): Promise<PDFData>;

  export = pdfParse;
}
