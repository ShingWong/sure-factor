import type { GeneratedOutput } from './generate'
import type { GeneratedStoreOutput } from './generate-store'

export interface FormattedOutput extends GeneratedOutput {
  formattedRoutes: string
  formattedTemplate: string
  formattedValidation: string
  formattedSanitization: string
}

export interface FormattedStoreOutput extends GeneratedStoreOutput {
  formattedFullCode: string
}

let prettierInstance: typeof import('prettier') | null = null

async function getPrettier(): Promise<typeof import('prettier')> {
  if (!prettierInstance) {
    prettierInstance = await import('prettier')
  }
  return prettierInstance
}

export async function formatCode(code: string, parser: 'typescript' | 'html' | 'babel' = 'typescript'): Promise<string> {
  try {
    const prettier = await getPrettier()
    const result = await prettier.format(code, {
      parser,
      semi: false,
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 100,
    })
    return result.trimEnd()
  } catch {
    return code
  }
}

export async function formatGeneratedOutput(output: GeneratedOutput): Promise<FormattedOutput> {
  const [formattedRoutes, formattedTemplate, formattedValidation, formattedSanitization] = await Promise.all([
    formatCode(output.routes, 'typescript'),
    formatCode(output.template, 'html'),
    formatCode(output.validation, 'typescript'),
    formatCode(output.sanitization, 'typescript'),
  ])

  return {
    ...output,
    formattedRoutes,
    formattedTemplate,
    formattedValidation,
    formattedSanitization,
  }
}

export async function formatGeneratedStoreOutput(output: GeneratedStoreOutput): Promise<FormattedStoreOutput> {
  const formattedFullCode = await formatCode(output.fullCode, 'typescript')

  return {
    ...output,
    formattedFullCode,
  }
}
