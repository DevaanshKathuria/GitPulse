export interface ParsedFunction {
  name: string;
  startLine: number;
  endLine: number;
  params: string[];
  returnType?: string;
  isExported: boolean;
  decorators?: string[];
}

export interface ParsedClass {
  name: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
}

export interface ParsedImport {
  source: string;
  specifiers: string[];
  isExternal: boolean;
}

export interface ParsedExport {
  name: string;
  type: "function" | "class" | "variable" | "default";
}

export interface ParsedInterface {
  name: string;
  startLine: number;
  endLine: number;
}

export interface ParsedRoute {
  method: string;
  path: string;
  line: number;
}

export interface ParsedCall {
  caller: string;
  callee: string;
}

export interface ParseResult {
  functions: ParsedFunction[];
  classes: ParsedClass[];
  imports: ParsedImport[];
  exports: ParsedExport[];
  interfaces: ParsedInterface[];
  routes: ParsedRoute[];
  callGraph: ParsedCall[];
}

export const emptyParseResult = (): ParseResult => ({
  functions: [],
  classes: [],
  imports: [],
  exports: [],
  interfaces: [],
  routes: [],
  callGraph: []
});
