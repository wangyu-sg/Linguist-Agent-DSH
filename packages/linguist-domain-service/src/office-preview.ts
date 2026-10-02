export async function readOfficePreviewText(bytes: Uint8Array): Promise<string> {
  const officeParser = await import('officeparser') as unknown as { parseOfficeAsync(file: Buffer): Promise<string> }
  const text = await officeParser.parseOfficeAsync(Buffer.from(bytes))
  if (text.trim() === '') throw new Error('Office document has no readable text')
  return text
}
