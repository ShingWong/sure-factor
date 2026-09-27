import type { GeneratedOutput } from './generate.js'
import type { GeneratedStoreOutput } from './generate-store.js'

export interface FormattedOutput extends GeneratedOutput {
  formattedRoutes: string
  formattedTemplate: string
  formattedValidation: string
  formattedSanitization: string
}

export interface FormattedStoreOutput extends GeneratedStoreOutput {
  formattedFullCode: string
}

type Prettier = typeof import('prettier')

// Memoize the in-flight promise rather than the resolved module. Caching the
// module only means a rejected import is retried on every call, and concurrent
// callers each start their own dynamic import.
let prettierPromise: Promise<Prettier> | null = null

class PrettierUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Prettier could not be loaded', { cause })
    this.name = 'PrettierUnavailableError'
  }
}

async function getPrettier(): Promise<Prettier> {
  if (!prettierPromise) {
    prettierPromise = import('prettier').catch((cause: unknown) => {
      // Allow a later call to retry a transient failure, but report the cause.
      prettierPromise = null
      throw new PrettierUnavailableError(cause)
    })
  }
  return prettierPromise
}

export async function formatCode(code: string, parser: 'typescript' | 'html' | 'babel' = 'typescript'): Promise<string> {
  let prettier: Prettier
  try {
    prettier = await getPrettier()
  } catch (err) {
    // A broken environment is not the same as unparsable input: every
    // `formatted*` field would be silently unformatted for the whole process.
    throw new PrettierUnavailableError(err)
  }

  try {
    const result = await prettier.format(code, {
      parser,
      semi: false,
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 100,
    })
    return result.trimEnd()
  } catch (err) {
    // Expected case: the generated snippet is not parseable. Keep the original
    // so generation still succeeds, but make the fallback observable.
    console.warn(
      `[format] prettier could not parse ${parser} input; emitting unformatted code. ` +
        `Cause: ${err instanceof Error ? err.message : String(err)}`
    )
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
  // Surface the risk: identical to the raw field means formatting silently
  // no-op'd, so a caller writing `formatted*` to disk may emit raw code.
  if (
    formattedRoutes === output.routes &&
    formattedTemplate === output.template &&
    formattedValidation === output.validation &&
    formattedSanitization === output.sanitization
  ) {
    console.warn(
      '[format] every generated field was returned unformatted; check prettier output before writing to disk.'
    )
  }

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
