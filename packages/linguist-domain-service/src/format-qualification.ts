import {
  CSV_ADAPTER_ID,
  JSON_ADAPTER_ID,
  MQXLIFF_ADAPTER_ID,
  PHRASE_DOCX_ADAPTER_ID,
  PHRASE_MXLIFF_ADAPTER_ID,
  SDLXLIFF_ADAPTER_ID,
  XLIFF_ADAPTER_ID,
  XLSX_ADAPTER_ID,
} from '@linguist/cat-formats'
import type { LinguistFormatQualification } from './client-contracts'
import { createDefaultCatFormatRegistry } from './format-registry'

const INTERNALLY_VERIFIED_FORMAT_IDS = new Set<string>([
  MQXLIFF_ADAPTER_ID,
  XLIFF_ADAPTER_ID,
  SDLXLIFF_ADAPTER_ID,
  PHRASE_MXLIFF_ADAPTER_ID,
  PHRASE_DOCX_ADAPTER_ID,
  CSV_ADAPTER_ID,
  JSON_ADAPTER_ID,
  XLSX_ADAPTER_ID,
])

export function listDefaultFormatQualifications(): LinguistFormatQualification[] {
  return createDefaultCatFormatRegistry().list().map((adapter) => ({
    formatId: adapter.id,
    extensions: [...adapter.extensions],
    internalVerification: INTERNALLY_VERIFIED_FORMAT_IDS.has(adapter.id) ? 'passed' : 'failed',
    platformQualification: 'unverified',
  }))
}
