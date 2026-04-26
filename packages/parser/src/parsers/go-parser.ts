import Parser, { type SyntaxNode } from "tree-sitter";
import Go from "tree-sitter-go";
import { emptyParseResult, type ParseResult } from "../types.js";

const nodeLine = (node: SyntaxNode): number => node.startPosition.row + 1;
const nodeEndLine = (node: SyntaxNode): number => node.endPosition.row + 1;

const walk = (node: SyntaxNode, visit: (current: SyntaxNode) => void): void => {
  visit(node);

  for (const child of node.namedChildren) {
    walk(child, visit);
  }
};

const fieldText = (node: SyntaxNode, fieldName: string): string | null => {
  return node.childForFieldName(fieldName)?.text ?? null;
};

const cleanImportPath = (text: string): string => {
  return text.replace(/^"/, "").replace(/"$/, "");
};

const isExternalImport = (source: string): boolean => {
  return !source.startsWith(".");
};

export const parseGo = (content: string): ParseResult => {
  try {
    const parser = new Parser();
    parser.setLanguage(Go as Parser.Language);
    const tree = parser.parse(content);
    const result = emptyParseResult();

    walk(tree.rootNode, (node) => {
      if (node.type === "function_declaration" || node.type === "method_declaration") {
        const name = fieldText(node, "name");
        if (name === null) {
          return;
        }

        result.functions.push({
          name,
          startLine: nodeLine(node),
          endLine: nodeEndLine(node),
          params: [],
          isExported: /^[A-Z]/.test(name)
        });

        result.exports.push({ name, type: "function" });
      }

      if (node.type === "type_spec") {
        const name = fieldText(node, "name");
        const hasStruct = node.namedChildren.some(
          (child) => child.type === "struct_type"
        );

        if (name !== null && hasStruct) {
          result.classes.push({
            name,
            startLine: nodeLine(node),
            endLine: nodeEndLine(node),
            isExported: /^[A-Z]/.test(name)
          });
          result.exports.push({ name, type: "class" });
        }
      }

      if (node.type === "import_spec") {
        const pathNode = node.childForFieldName("path");
        if (pathNode !== null) {
          const source = cleanImportPath(pathNode.text);
          result.imports.push({
            source,
            specifiers: [],
            isExternal: isExternalImport(source)
          });
        }
      }
    });

    return result;
  } catch {
    return emptyParseResult();
  }
};
