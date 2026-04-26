declare module "tree-sitter" {
  export interface Point {
    row: number;
    column: number;
  }

  export interface SyntaxNode {
    type: string;
    text: string;
    startPosition: Point;
    endPosition: Point;
    namedChildren: SyntaxNode[];
    parent: SyntaxNode | null;
    childForFieldName(name: string): SyntaxNode | null;
  }

  export interface Tree {
    rootNode: SyntaxNode;
  }

  export default class Parser {
    setLanguage(language: unknown): void;
    parse(input: string): Tree;
  }
}

declare module "tree-sitter-python" {
  const language: unknown;
  export default language;
}

declare module "tree-sitter-go" {
  const language: unknown;
  export default language;
}
