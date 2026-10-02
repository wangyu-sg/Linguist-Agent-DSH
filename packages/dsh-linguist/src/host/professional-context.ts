import { readFileSync } from 'node:fs'
import { professionalHash, type ProfessionalResources } from '@linguist/cat-core'

/** Installed product resources, loaded once per Host; no runtime write or model approval API. */
export function loadProfessionalResources(base: URL): ProfessionalResources {
  const standard: ProfessionalResources['standard'] = JSON.parse(readFileSync(new URL('standard.v1.json', base), 'utf8'))
  const examples: ProfessionalResources['examples'] = JSON.parse(readFileSync(new URL('examples.v1.json', base), 'utf8'))
  return { standard, examples, standardHash: professionalHash(standard), examplesHash: professionalHash(examples) }
}
