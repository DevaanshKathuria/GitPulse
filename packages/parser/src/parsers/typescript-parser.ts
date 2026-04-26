import {
  Node,
  Project,
  SyntaxKind,
  type CallExpression,
  type FunctionDeclaration,
  type MethodDeclaration,
  type Node as TsMorphNode
} from "ts-morph";
import { emptyParseResult, type ParseResult, type ParsedExport } from "../types.js";

const routeMethods = new Set(["get", "post", "put", "delete", "use"]);

const isExternalImport = (source: string): boolean => {
  return !source.startsWith(".") && !source.startsWith("/");
};

const isNodeExported = (node: TsMorphNode): boolean => {
  return Node.isExportable(node) ? node.isExported() : false;
};

const lineNumber = (node: TsMorphNode): number => {
  return node.getStartLineNumber();
};

const endLineNumber = (node: TsMorphNode): number => {
  return node.getEndLineNumber();
};

const functionName = (
  node: FunctionDeclaration | MethodDeclaration
): string | null => {
  if (Node.isFunctionDeclaration(node)) {
    return node.getName() ?? null;
  }

  return node.getName();
};

const calleeName = (callExpression: CallExpression): string | null => {
  const expression = callExpression.getExpression();

  if (Node.isIdentifier(expression)) {
    return expression.getText();
  }

  if (Node.isPropertyAccessExpression(expression)) {
    return expression.getName();
  }

  return null;
};

const exportedType = (node: TsMorphNode): ParsedExport["type"] | null => {
  if (Node.isFunctionDeclaration(node)) {
    return "function";
  }

  if (Node.isClassDeclaration(node)) {
    return "class";
  }

  if (Node.isVariableStatement(node)) {
    return "variable";
  }

  return null;
};

const isRouteCall = (callExpression: CallExpression): boolean => {
  const expression = callExpression.getExpression();

  if (!Node.isPropertyAccessExpression(expression)) {
    return false;
  }

  const receiver = expression.getExpression().getText();
  return (
    (receiver === "router" || receiver === "app") &&
    routeMethods.has(expression.getName())
  );
};

export const parseTypeScript = (
  filePath: string,
  content: string
): ParseResult => {
  try {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        allowJs: true
      }
    });
    const sourceFile = project.createSourceFile(filePath, content, {
      overwrite: true
    });
    const result = emptyParseResult();

    for (const importDeclaration of sourceFile.getImportDeclarations()) {
      const source = importDeclaration.getModuleSpecifierValue();
      result.imports.push({
        source,
        specifiers: importDeclaration
          .getNamedImports()
          .map((specifier) => specifier.getName()),
        isExternal: isExternalImport(source)
      });
    }

    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (name === undefined) {
        continue;
      }

      result.functions.push({
        name,
        startLine: lineNumber(fn),
        endLine: endLineNumber(fn),
        params: fn.getParameters().map((parameter) => parameter.getName()),
        returnType: fn.getReturnTypeNode()?.getText(),
        isExported: fn.isExported()
      });
    }

    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName();
      if (name === undefined) {
        continue;
      }

      result.classes.push({
        name,
        startLine: lineNumber(cls),
        endLine: endLineNumber(cls),
        isExported: cls.isExported()
      });
    }

    for (const iface of sourceFile.getInterfaces()) {
      result.interfaces.push({
        name: iface.getName(),
        startLine: lineNumber(iface),
        endLine: endLineNumber(iface)
      });
    }

    for (const exportDeclaration of sourceFile.getExportDeclarations()) {
      for (const namedExport of exportDeclaration.getNamedExports()) {
        result.exports.push({
          name: namedExport.getName(),
          type: "variable"
        });
      }
    }

    for (const statement of sourceFile.getStatements()) {
      if (Node.isExportAssignment(statement)) {
        result.exports.push({
          name: statement.getExpression().getText(),
          type: "default"
        });
        continue;
      }

      if (!isNodeExported(statement)) {
        continue;
      }

      const type = exportedType(statement);
      if (type === null) {
        continue;
      }

      if (Node.isVariableStatement(statement)) {
        for (const declaration of statement.getDeclarations()) {
          result.exports.push({
            name: declaration.getName(),
            type
          });
        }
        continue;
      }

      if (
        Node.isFunctionDeclaration(statement) ||
        Node.isClassDeclaration(statement)
      ) {
        const name = statement.getName();
        if (name !== undefined) {
          result.exports.push({ name, type });
        }
      }
    }

    for (const callExpression of sourceFile.getDescendantsOfKind(
      SyntaxKind.CallExpression
    )) {
      if (!isRouteCall(callExpression)) {
        continue;
      }

      const expression = callExpression.getExpression();
      const firstArg = callExpression.getArguments()[0];

      if (
        Node.isPropertyAccessExpression(expression) &&
        firstArg !== undefined &&
        Node.isStringLiteral(firstArg)
      ) {
        result.routes.push({
          method: expression.getName(),
          path: firstArg.getLiteralValue(),
          line: lineNumber(callExpression)
        });
      }
    }

    const callableNodes = [
      ...sourceFile.getFunctions(),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)
    ];

    for (const callable of callableNodes) {
      const caller = functionName(callable);
      if (caller === null) {
        continue;
      }

      for (const callExpression of callable.getDescendantsOfKind(
        SyntaxKind.CallExpression
      )) {
        const callee = calleeName(callExpression);
        if (callee !== null && callee !== caller) {
          result.callGraph.push({ caller, callee });
        }
      }
    }

    return result;
  } catch {
    return emptyParseResult();
  }
};
