import { register } from 'node:module'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isMainThread } from 'node:worker_threads'

if (isMainThread && !globalThis.__r59TsResolverRegistered) {
  globalThis.__r59TsResolverRegistered = true
  register(import.meta.url)
}

const TS_CANDIDATE_EXTENSIONS = ['.ts', '.mts', '.tsx', '.js', '.mjs', '.json']

function isExistingFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile()
  } catch {
    return false
  }
}

function resolveCandidateFile(basePath) {
  const ext = path.extname(basePath)
  if (ext) {
    if (isExistingFile(basePath)) return basePath
    if (ext === '.js') {
      const tsPath = basePath.slice(0, -3) + '.ts'
      if (isExistingFile(tsPath)) return tsPath
    }
    return null
  }

  for (const candidateExt of TS_CANDIDATE_EXTENSIONS) {
    const candidate = `${basePath}${candidateExt}`
    if (isExistingFile(candidate)) return candidate
  }

  for (const indexExt of ['.ts', '.mts', '.js', '.mjs']) {
    const indexCandidate = path.join(basePath, `index${indexExt}`)
    if (isExistingFile(indexCandidate)) return indexCandidate
  }

  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (
    context.parentURL &&
    context.parentURL.startsWith('file:') &&
    (specifier.startsWith('./') || specifier.startsWith('../'))
  ) {
    const [rawPath, suffix = ''] = specifier.split(/(?=[?#])/, 2)
    const parentDir = path.dirname(fileURLToPath(context.parentURL))
    const targetPath = path.resolve(parentDir, rawPath)
    const resolvedFile = resolveCandidateFile(targetPath)
    if (resolvedFile) {
      const resolvedUrl = pathToFileURL(resolvedFile).href + suffix
      if (resolvedFile.endsWith('.json') && context.importAttributes?.type !== 'json') {
        return { url: resolvedUrl, format: 'r59-json-esm', shortCircuit: true }
      }
      return nextResolve(resolvedUrl, context)
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (context.format === 'r59-json-esm') {
    const filePath = fileURLToPath(url.split(/[?#]/, 1)[0])
    const rawJson = readFileSync(filePath, 'utf8')
    return {
      format: 'module',
      source: `export default ${rawJson};`,
      shortCircuit: true
    }
  }
  return nextLoad(url, context)
}
