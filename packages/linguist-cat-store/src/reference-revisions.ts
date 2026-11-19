// Each row versions one retrieval dependency. Imported corpora share a revision per source.
// SQLite maintains these inside the writer's transaction, including writes from other processes.
const bump = (select: string) => `INSERT INTO reference_revisions(resource_key) ${select}
  ON CONFLICT(resource_key) DO UPDATE SET revision=excluded.revision;`
const touch = (key: string) => bump(`SELECT ${key} WHERE true`)
const drop = (key: string) => `DELETE FROM reference_revisions WHERE resource_key=${key};`
const key = (kind: string, id: string) => `'${kind}:' || ${id}`
const trigger = (table: string, event: string, body: string, suffix = event.split(' ')[0]) =>
  `CREATE TRIGGER group_versions_${table}_${suffix} AFTER ${event} ON ${table} BEGIN ${body} END;`

// Keep only standalone/manual term clocks. A term shared by multiple imports bumps each actual source.
const manual = (id: string) => `(NOT EXISTS (SELECT 1 FROM term_entry_sources WHERE term_id=${id})
  OR EXISTS (SELECT 1 FROM task_resource_refs WHERE resource_key='term:' || ${id}))`
const termSources = (id: string) => bump(`SELECT DISTINCT 'reference:' || reference_id FROM term_entry_sources WHERE term_id=${id}`)
const term = (id: string) => bump(`SELECT 'term:' || ${id} WHERE ${manual(id)}`)
// Changing provenance on a deduplicated term may also change which note is displayed by its other owners.
const otherTermOwners = (r: string) => bump(`SELECT DISTINCT 'reference:' || reference_id FROM term_entry_sources
  WHERE term_id=${r}.term_id AND reference_id<>${r}.reference_id
  UNION ALL SELECT 'term:' || ${r}.term_id FROM task_resource_refs WHERE resource_key='term:' || ${r}.term_id`)
const linkAdded = (r: string) => `${touch(key('reference', r + '.reference_id'))}${otherTermOwners(r)}
  DELETE FROM reference_revisions WHERE resource_key='term:' || ${r}.term_id AND NOT ${manual(r + '.term_id')};`
const linkRemoved = (r: string) => `${touch(key('reference', r + '.reference_id'))}${otherTermOwners(r)}
  INSERT INTO reference_revisions(resource_key) SELECT 'term:' || id FROM term_entries
  WHERE id=${r}.term_id AND ${manual(r + '.term_id')} ON CONFLICT(resource_key) DO NOTHING;`

const tmSource = (r: string) => `'tm-source:' || COALESCE(${r}.source_id,'')`
const tmKey = (r: string) => `CASE WHEN ${r}.source_id='approved:' || ${r}.project_id THEN 'exemplar:' || ${r}.id ELSE ${tmSource(r)} END`
const tmRemoved = (r: string) => `${bump(`SELECT ${tmSource(r)} WHERE ${r}.source_id IS NOT ('approved:' || ${r}.project_id)`)}
  DELETE FROM reference_revisions WHERE resource_key IN ('exemplar:' || ${r}.id,'local:exemplar:' || ${r}.id);`
// A source's enable flag, priority and label are part of every candidate. Exemplars are individually scoped.
const sourceChanged = (r: string) => bump(`SELECT 'tm-source:' || ${r}.id WHERE ${r}.id <> 'approved:' || ${r}.project_id
  UNION ALL SELECT 'exemplar:' || id FROM tm_units WHERE project_id=${r}.project_id AND source_id=${r}.id AND ${r}.id='approved:' || ${r}.project_id`)
const docKey = (r: string) => key('document', `COALESCE(${r}.parent_context_doc_id,${r}.id)`)
const docParent = (r: string) => bump(`SELECT 'document:' || COALESCE(parent_context_doc_id,id) FROM context_docs WHERE id=${r}.context_doc_id`)
const linkedAsset = (r: string) => bump(`SELECT 'asset:' || COALESCE(${r}.asset_id,
  (SELECT asset_id FROM segments WHERE id=${r}.segment_id)) WHERE ${r}.asset_id IS NOT NULL OR EXISTS (SELECT 1 FROM segments WHERE id=${r}.segment_id)`)
const docRemoved = (r: string) => `${drop(key('document', r + '.id'))}${bump(`SELECT 'document:' || id FROM context_docs WHERE id=${r}.parent_context_doc_id`)}`
const native = [
  ['style_guide_rules', 'rule'], ['tech_constraints', 'rule'], ['voice_profiles', 'voice'],
  ['sentence_patterns', 'pattern'], ['reference_imports', 'reference'], ['assets', 'asset'],
] as const

export const REFERENCE_REVISION_SCHEMA = `
  CREATE TABLE reference_revisions (revision INTEGER PRIMARY KEY AUTOINCREMENT, resource_key TEXT NOT NULL UNIQUE);
  ${native.map(([table, kind]) => [
    bump(`SELECT '${kind}:' || id FROM ${table} WHERE true`),
    trigger(table, 'INSERT', touch(key(kind, 'NEW.id'))),
    trigger(table, 'UPDATE', drop(key(kind, 'OLD.id')) + touch(key(kind, 'NEW.id'))),
    trigger(table, 'DELETE', drop(key(kind, 'OLD.id'))),
  ].join('\n')).join('\n')}
  ${trigger('segments', 'INSERT', touch(key('asset', 'NEW.asset_id')))}
  ${trigger('segments', 'UPDATE', bump("SELECT 'asset:' || OLD.asset_id UNION SELECT 'asset:' || NEW.asset_id WHERE true"))}
  ${trigger('segments', 'DELETE', touch(key('asset', 'OLD.asset_id')))}
  ${bump(`SELECT 'term:' || id FROM term_entries WHERE ${manual('term_entries.id')}`)}
  ${trigger('term_entries', 'INSERT', term('NEW.id'))}
  ${trigger('term_entries', 'UPDATE', drop(key('term', 'OLD.id')) + term('NEW.id') + termSources('NEW.id'))}
  ${trigger('term_entries', 'DELETE', drop(key('term', 'OLD.id')))}
  ${trigger('term_entry_sources', 'INSERT', linkAdded('NEW'))}
  ${trigger('term_entry_sources', 'UPDATE', linkRemoved('OLD') + linkAdded('NEW'))}
  ${trigger('term_entry_sources', 'DELETE', linkRemoved('OLD'))}
  ${bump("SELECT DISTINCT " + tmKey('tm_units') + ' FROM tm_units WHERE true')}
  ${trigger('tm_units', 'INSERT', touch(tmKey('NEW')))}
  ${trigger('tm_units', 'UPDATE OF id,project_id,source,target,source_locale,target_locale,origin,source_id,source_hash,original_tuid,context_key,previous_source_hash,next_source_hash,metadata_json,source_inline_xml,target_inline_xml,created_at', tmRemoved('OLD') + touch(tmKey('NEW')))}
  ${trigger('tm_units', 'UPDATE OF locally_confirmed,local_metadata_json', touch("'local:' || (" + tmKey('NEW') + ')'), 'local')}
  ${trigger('tm_units', 'DELETE', tmRemoved('OLD'))}
  ${trigger('tm_sources', 'INSERT', sourceChanged('NEW'))}
  ${trigger('tm_sources', 'UPDATE', sourceChanged('OLD') + sourceChanged('NEW'))}
  ${trigger('tm_sources', 'DELETE', sourceChanged('OLD'))}
  ${bump('SELECT DISTINCT ' + docKey('context_docs') + ' FROM context_docs WHERE true')}
  ${trigger('context_docs', 'INSERT', touch(docKey('NEW')))}
  ${trigger('context_docs', 'UPDATE', docRemoved('OLD') + touch(docKey('NEW')))}
  ${trigger('context_docs', 'DELETE', docRemoved('OLD'))}
  ${trigger('context_anchors', 'INSERT', docParent('NEW'))}
  ${trigger('context_anchors', 'UPDATE', docParent('OLD') + docParent('NEW'))}
  ${trigger('context_anchors', 'DELETE', docParent('OLD'))}
  ${trigger('context_evidence_links', 'INSERT', linkedAsset('NEW'))}
  ${trigger('context_evidence_links', 'UPDATE', linkedAsset('OLD') + linkedAsset('NEW'))}
  ${trigger('context_evidence_links', 'DELETE', linkedAsset('OLD'))}
`
