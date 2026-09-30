import * as React from 'react'
import { atom, Provider, useAtom, type PrimitiveAtom } from 'jotai'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button, Checkbox, Input, Menu, Tooltip, IconPanelLeftOutlineRegular, IconEllipsisOutlineRegular, IconChevronDownOutlineRegular, IconCheckOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  LinguistAssetInfo,
  LinguistCatConfirmStageBulkResult,
  LinguistCatContextResult,
  LinguistCatListQaFindingsResult,
  LinguistCatQueryResult,
  LinguistAssetsQueryResult,
  LinguistContextDocInfo,
  LinguistProjectInfo,
  LinguistProjectMutationEvent,
  LinguistProjectOpenResult,
  LinguistProjectSummary,
  LinguistQaFindingInfo,
  LinguistProposalInfo,
  LinguistSegmentInfo,
  LinguistStyleGuideRuleInfo,
  LinguistTurnContextV1,
  LinguistVoiceProfileInfo,
} from '@linguist/domain-service/contracts'
import { invoke, required, subscribeProject } from './api'
import { TargetEditor, createTargetDraftState, splitProtectedText, type TargetEditorDraft, type TargetEditorHandle } from './TargetEditor'
import { findNextEditableRow, mergeIndexedPage, pageOffsetsForRange, virtualRowKey, gridRowKeyAction } from './cat-virtual-utils'
import type { TargetSaveResult } from './cat-edit-utils'
import { QaPanel, ProposalPanel, ReferencePanel, AssetsPanel, DeliveryPanel, ProjectSettingsPanel } from './Panels'
import { RunPanel } from './RunPanel'
import { PreviewView, type PreviewRequest } from './PreviewView'
import { UnknownTagNotice } from './UnknownTagNotice'
import { requestCatNavigation, useCatNavigation, type CatDock } from './cat-navigation'
import { TERM_STATUS_LABELS, nextStageItemLabel, segmentStatusBadgeTitle, stageActionLabel, stageCompletionLabel, stageFilterOptions, stageName, stageProgressLabel } from './workflow-ui'
import { readWorkbenchLocation, writeWorkbenchLocation, type WorkbenchLocation } from './workbench-location'
import { publishWorkbenchComposerContext } from './composer-context'
import { getCatEditorState, type CatEditorState } from './cat-editor-state'
import { Splitter } from './Splitter'
import { CatStatusBar } from './CatStatusBar'
import { qaSeverityLabel, qaSeverityTier, qaTierLabel } from './qa-severity'
import { useT } from './ui-locale'
import styles from './Workbench.module.css'

const PAGE_SIZE = 200
type Dock = CatDock
const dockItems: readonly { id: Dock; label: string }[] = [
  { id: 'qa', label: 'QA' },
  { id: 'proposals', label: '建议' }, { id: 'references', label: 'TM / TB' },
  { id: 'assets', label: '资料' }, { id: 'delivery', label: '交付' },
  { id: 'run', label: '运行' },
  { id: 'settings', label: '项目设置' },
]

interface Dataset { signature: string; total: number; ids: string[]; rows: ReadonlyMap<number, LinguistSegmentInfo> }
interface RowSignal { proposal?: LinguistProposalInfo; qaCount: number; highestSeverity?: LinguistQaFindingInfo['severity'] }

export function CatWorkbench({ projectId, sessionId, onSendAgentTask, onOpenBatchPreview, onCancelRun, onOpenSession, capabilities }: { projectId: string; sessionId: string; onSendAgentTask: (text: string, context: LinguistTurnContextV1) => Promise<void>; onOpenBatchPreview: (assetId: string) => void; onCancelRun: () => Promise<void>; onOpenSession: (sessionId: string) => Promise<void>; capabilities: React.ReactNode }): React.ReactElement {
  const editorState = getCatEditorState(sessionId, projectId)
  return <Provider store={editorState.store}><WorkbenchBody projectId={projectId} sessionId={sessionId} onSendAgentTask={onSendAgentTask} onOpenBatchPreview={onOpenBatchPreview} onCancelRun={onCancelRun} onOpenSession={onOpenSession} capabilities={capabilities} editorState={editorState} /></Provider>
}

function WorkbenchBody({ projectId, sessionId, onSendAgentTask, onOpenBatchPreview, onCancelRun, onOpenSession, capabilities, editorState }: { projectId: string; sessionId: string; onSendAgentTask: (text: string, context: LinguistTurnContextV1) => Promise<void>; onOpenBatchPreview: (assetId: string) => void; onCancelRun: () => Promise<void>; onOpenSession: (sessionId: string) => Promise<void>; capabilities: React.ReactNode; editorState: CatEditorState }): React.ReactElement {
  const t = useT()
  const navigation = useCatNavigation(sessionId, projectId)
  const storedLocation = React.useMemo(() => readWorkbenchLocation(projectId), [projectId])
  const [project, setProject] = React.useState<LinguistProjectInfo>()
  const [summary, setSummary] = React.useState<LinguistProjectSummary>()
  const [loadError, setLoadError] = React.useState('')
  const [openRetry, setOpenRetry] = React.useState(0)
  const [notice, setNotice] = React.useState('')
  const [assetId, setAssetId] = React.useState<string | undefined>(storedLocation.value.assetId)
  const [assetSearch, setAssetSearch] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [stageFilter, setStageFilter] = React.useState('')
  const [selectedId, setSelectedId] = React.useState<string | undefined>(storedLocation.value.segmentId)
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set())
  const [agentReference, setAgentReference] = React.useState<{ segmentId: string; assetId: string; ordinal: number }>()
  const uiRevision = React.useRef(0)
  // Background selection cleanup must not cancel an explicit jump.
  const navigationRevision = React.useRef(0)
  const confirmedDatasetRevision = React.useRef(0)
  const [dock, setDock] = React.useState<Dock>(storedLocation.value.dock)
  const [dockOpen, setDockOpen] = React.useState(storedLocation.value.dockOpen)
  const [dockHeight, setDockHeight] = React.useState(storedLocation.value.dockHeight)
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const dockRef = React.useRef<HTMLDivElement>(null)
  const [assetNavigatorOpen, setAssetNavigatorOpen] = React.useState(storedLocation.value.assetNavigatorOpen)
  const [assetNavigatorWidth, setAssetNavigatorWidth] = React.useState(storedLocation.value.assetNavigatorWidth)
  const [inspectorWidth, setInspectorWidth] = React.useState(storedLocation.value.inspectorWidth)
  const [workbenchSize, setWorkbenchSize] = React.useState({ width: 0, height: 0, availableHeight: 0 })
  const [inspectorOpen, setInspectorOpen] = React.useState(false)
  const workbenchRef = React.useRef<HTMLElement>(null)
  const compactLayout = React.useRef<boolean>()
  const [displayOpen, setDisplayOpen] = React.useState(false)
  const navigationTrigger = React.useRef<HTMLButtonElement>(null)
  const displayTrigger = React.useRef<HTMLButtonElement>(null)
  const [dataset, setDataset] = React.useState<Dataset>()
  const [loading, setLoading] = React.useState(true)
  const [reload, setReload] = React.useState(0)
  const [mutation, setMutation] = React.useState(0)
  const [jobUpdates, setJobUpdates] = React.useState<ReadonlyMap<string, LinguistProjectMutationEvent>>(new Map())
  const [focusIndex, setFocusIndex] = React.useState<number>()
  const [visibleRange, setVisibleRange] = React.useState({ start: 0, end: 20 })
  const [rowSignals, setRowSignals] = React.useState<ReadonlyMap<string, RowSignal>>(new Map())
  const rowSignalLoaded = React.useRef(new Set<string>())
  const rowSignalLoading = React.useRef(new Set<string>())
  const [rowSignalRefresh, setRowSignalRefresh] = React.useState(0)
  const [qaNavigation, setQaNavigation] = React.useState<{ findingId?: string; segmentId: string }>()
  const [proposalNavigation, setProposalNavigation] = React.useState<string>()
  const [jumpBusy, setJumpBusy] = React.useState(false)
  const reviewingProposals = React.useRef(new Set<string>())
  const [reviewingIds, setReviewingIds] = React.useState<ReadonlySet<string>>(new Set())
  const [bulkBusy, setBulkBusy] = React.useState(false)
  const [editor, setEditor] = React.useState<{segmentId:string;handle:TargetEditorHandle}>()
  const handleEditorChange = React.useCallback((segmentId: string, handle: TargetEditorHandle | undefined) => {
    setEditor((current) => handle ? { segmentId, handle } : current?.segmentId === segmentId ? undefined : current)
  }, [])
  const loadingPages = React.useRef(new Map<number, { ids: string[]; request: Promise<LinguistSegmentInfo[]> }>())
  const pendingNavigation = React.useRef<{ id: string; signature: string }>()
  const signature = `${projectId}\0${assetId ?? ''}\0${stageFilter}\0${search}`
  const currentSignature = React.useRef(signature)
  currentSignature.current = signature
  React.useLayoutEffect(() => {
    navigationRevision.current += 1
    if (pendingNavigation.current?.signature !== signature) pendingNavigation.current = undefined
    setFocusIndex(undefined)
  }, [signature])
  const active = selectedId === undefined ? undefined : [...(dataset?.rows.values() ?? [])].find((row) => row.id === selectedId)
  const workflowStage = project?.workflowStage ?? 'translation'
  const assetMaximum = workbenchSize.width ? Math.max(180, Math.min(420, Math.floor(workbenchSize.width * .86))) : 420
  const inspectorMaximum = workbenchSize.width ? Math.max(240, Math.min(480, Math.floor(workbenchSize.width < 980 ? workbenchSize.width * .9 : workbenchSize.width - (assetNavigatorOpen ? assetNavigatorWidth : 0) - 320))) : 480
  const dockMaximum = workbenchSize.height ? Math.max(80, Math.floor(Math.min(480, workbenchSize.height * .6, workbenchSize.availableHeight - 120))) : 480

  React.useEffect(() => { if (storedLocation.error) setNotice(t('工作台位置读取失败，已使用默认布局：{error}', { error: storedLocation.error })) }, [storedLocation])
  React.useEffect(() => {
    const location: WorkbenchLocation = { assetId, segmentId: selectedId, assetNavigatorOpen, assetNavigatorWidth, inspectorWidth, dockOpen, dock, dockHeight }
    const timer = window.setTimeout(() => {
      try { writeWorkbenchLocation(projectId, location) }
      catch (cause) { setNotice(t('工作台位置保存失败：{error}', { error: String(cause) })) }
    }, 150)
    return () => window.clearTimeout(timer)
  }, [projectId, assetId, selectedId, assetNavigatorOpen, assetNavigatorWidth, inspectorWidth, dockOpen, dock, dockHeight])

  React.useEffect(() => {
    rowSignalLoaded.current.clear()
    rowSignalLoading.current.clear()
    setRowSignals(new Map())
  }, [signature, mutation, reload, rowSignalRefresh])

  React.useEffect(() => {
    const ids = dataset?.ids.slice(visibleRange.start, visibleRange.end + 1).filter((id) => !rowSignalLoaded.current.has(id) && !rowSignalLoading.current.has(id)) ?? []
    if (ids.length === 0) return
    ids.forEach((id) => rowSignalLoading.current.add(id))
    let live = true
    Promise.all(ids.map((segmentId) => required<LinguistCatContextResult>('linguistCatGetContext', { projectId, segmentId })))
      .then((contexts) => {
        if (!live) return
        setRowSignals((current) => {
          const next = new Map(current)
          contexts.forEach((context) => {
            const open = context.qaFindings.filter((finding) => finding.status === 'open')
            const highestSeverity = open.map((finding) => finding.severity).sort()[0]
            next.set(context.segment.id, { proposal: context.pendingProposal, qaCount: open.length, highestSeverity })
            rowSignalLoaded.current.add(context.segment.id)
          })
          return next
        })
      })
      .catch((cause: unknown) => { if (live) setNotice(String(cause)) })
      .finally(() => ids.forEach((id) => rowSignalLoading.current.delete(id)))
    return () => { live = false }
  }, [projectId, dataset?.ids, visibleRange.start, visibleRange.end, mutation, reload, rowSignalRefresh])

  React.useEffect(() => { setSelectedIds(new Set()) }, [assetId])
  React.useLayoutEffect(() => { uiRevision.current += 1 }, [assetId, selectedId, selectedIds, agentReference, dock, search, stageFilter])
  React.useLayoutEffect(() => {
    if (!project) return
    publishWorkbenchComposerContext(sessionId, {
      projectId,
      projectName: project.name,
      assetId,
      assetName: summary?.assets.find((asset) => asset.assetId === assetId)?.filename,
      referenceSegmentId: agentReference && summary?.assets.some((asset) => asset.assetId === agentReference.assetId) ? agentReference.segmentId : undefined,
      selectedCount: selectedIds.size,
      selection: {
        schemaVersion: 1, projectId,
        ...(agentReference || assetId ? { assetId: agentReference?.assetId ?? assetId } : {}),
        ...(agentReference ? { activeSegmentId: agentReference.segmentId } : {}),
        selectedSegmentIds: agentReference && agentReference.assetId !== assetId ? [] : [...selectedIds],
        capturedAt: new Date().toISOString(), uiRevision: uiRevision.current,
      },
      clearReference: () => setAgentReference(undefined),
      clearSelection: () => setSelectedIds(new Set()),
    })
  }, [sessionId, projectId, project, summary, assetId, agentReference, selectedIds, selectedId, dock, search, stageFilter])
  React.useEffect(() => () => publishWorkbenchComposerContext(sessionId), [sessionId])
  const sendScopedAgentTask = async (text: string): Promise<void> => {
    const selectedSegmentIds = agentReference && agentReference.assetId !== assetId ? [] : [...selectedIds]
    if (selectedSegmentIds.length > 100) throw new Error(t('选区超过 100 段，请缩小范围后发送 Agent 任务。'))
    await onSendAgentTask(text, {
      schemaVersion: 1,
      projectId,
      ...(agentReference || assetId ? { assetId: agentReference?.assetId ?? assetId } : {}),
      ...(agentReference ? { activeSegmentId: agentReference.segmentId } : {}),
      selectedSegmentIds,
      capturedAt: new Date().toISOString(),
      uiRevision: uiRevision.current,
    })
  }

  React.useEffect(() => {
    const element = workbenchRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect()
      const availableHeight = bodyRef.current!.getBoundingClientRect().height + dockRef.current!.getBoundingClientRect().height
      setWorkbenchSize((current) => current.width === width && current.height === height && current.availableHeight === availableHeight ? current : { width, height, availableHeight })
      const compact = width < 980
      if (compactLayout.current === undefined) { compactLayout.current = compact; if (compact) setAssetNavigatorOpen(false); setInspectorOpen(width > 1080) }
      else if (compactLayout.current !== compact) { compactLayout.current = compact; setAssetNavigatorOpen(!compact); setInspectorOpen(!compact && width > 1080) }
    })
    observer.observe(element)
    observer.observe(bodyRef.current!)
    observer.observe(dockRef.current!)
    return () => observer.disconnect()
  }, [project?.id])

  const refreshSummary = React.useCallback(async () => {
    const next = await required<LinguistProjectSummary>('linguistProjectsGetSummary', { projectId })
    setSummary(next)
    setProject(next.project)
    setAssetId((current) => current !== undefined && !next.assets.some((asset) => asset.assetId === current)
      ? next.assets[0]?.assetId : current)
  }, [projectId])

  React.useEffect(() => {
    let live = true
    Promise.all([
      required<LinguistProjectOpenResult>('linguistProjectsOpen', { projectId }),
      required<LinguistProjectSummary>('linguistProjectsGetSummary', { projectId }),
    ]).then(([opened, overview]) => {
      if (!live) return
      setProject(opened.project)
      setSummary(overview)
      setAssetId((current) => pendingNavigation.current ? undefined : current ?? overview.assets[0]?.assetId)
      setLoadError('')
    }).catch((error: unknown) => {
      if (live) setLoadError(String(error))
    })
    return () => { live = false }
  }, [projectId, openRetry])

  React.useEffect(() => { setJobUpdates(new Map()) }, [projectId, sessionId])
  React.useEffect(() => subscribeProject(projectId, 0, (event) => {
    if (event.kind === 'job-updated' && event.sessionId === sessionId && event.jobId && event.job) {
      setJobUpdates((current) => new Map(current).set(event.jobId!, event))
      if (event.job.status === 'running' || event.job.status === 'pending') return
    }
    setMutation((current) => Math.max(current + 1, event.sequence ?? 0))
  }, () => setMutation((current) => current + 1)), [projectId, sessionId])

  React.useEffect(() => {
    if (mutation === 0) return
    void refreshSummary().catch((error: unknown) => setNotice(String(error)))
    setReload((current) => current + 1)
  }, [mutation, refreshSummary])

  React.useEffect(() => {
    if (project === undefined) return
    let live = true
    const queryRevision = navigationRevision.current
    const datasetRevision = confirmedDatasetRevision.current
    const requested = pendingNavigation.current
    setLoading(true)
    required<LinguistCatQueryResult>('linguistCatQuery', {
      projectId, assetId, currentStageState: stageFilter || undefined,
      search: search || undefined, limit: PAGE_SIZE, offset: 0, includeIndex: true,
    }).then((page) => {
      if (!live || datasetRevision !== confirmedDatasetRevision.current) return
      setDataset({ signature, total: page.total, ids: page.segmentIds, rows: mergeIndexedPage(new Map(), 0, page.segments) })
      setLoading(false)
      if (queryRevision !== navigationRevision.current) return
      if (requested) {
        const index = page.segmentIds.indexOf(requested.id)
        if (pendingNavigation.current === requested) pendingNavigation.current = undefined
        if (index >= 0) { setSelectedId(requested.id); setFocusIndex(index) }
        else setNotice(t('句段 {id} 不在当前项目范围内', { id: requested.id }))
      } else if (selectedId !== undefined && !page.segmentIds.includes(selectedId)) setSelectedId(undefined)
    }).catch((error: unknown) => {
      if (live) { setLoadError(String(error)); setLoading(false) }
    })
    return () => { live = false }
  }, [project, projectId, assetId, stageFilter, search, reload])

  const loadPage = React.useCallback((offset: number, indexed: Dataset): Promise<LinguistSegmentInfo[]> => {
    if (indexed.signature !== currentSignature.current) return Promise.resolve([])
    const pending = loadingPages.current.get(offset)
    if (pending?.ids === indexed.ids) return pending.request
    if (indexed.rows.has(offset)) return Promise.resolve(indexed.ids.slice(offset, offset + PAGE_SIZE).map((_, index) => indexed.rows.get(offset + index)!))
    const request: Promise<LinguistSegmentInfo[]> = required<LinguistCatQueryResult>('linguistCatQuery', {
      projectId, assetId, currentStageState: stageFilter || undefined,
      search: search || undefined, limit: PAGE_SIZE, offset, includeIndex: false,
    }).then((page) => {
      setDataset((current) => current?.ids === indexed.ids
        ? { ...current, rows: mergeIndexedPage(current.rows, offset, page.segments) } : current)
      return page.segments
    }).finally(() => { if (loadingPages.current.get(offset)?.request === request) loadingPages.current.delete(offset) })
    loadingPages.current.set(offset, { ids: indexed.ids, request })
    return request
  }, [projectId, assetId, stageFilter, search])

  const updateRow = React.useCallback((row: LinguistSegmentInfo) => {
    setDataset((current) => {
      if (current === undefined) return current
      const index = current.ids.indexOf(row.id)
      if (index < 0) return current
      const rows = new Map(current.rows)
      rows.set(index, row)
      return { ...current, rows }
    })
  }, [])

  const reloadRow = React.useCallback(async (segmentId: string) => {
    const context = await required<LinguistCatContextResult>('linguistCatGetContext', { projectId, segmentId })
    updateRow(context.segment)
    return context.segment
  }, [projectId, updateRow])

  const save = React.useCallback(async (segment: LinguistSegmentInfo, target: string): Promise<TargetSaveResult> => {
    try {
      const result = await invoke<LinguistSegmentInfo>('linguistCatEditSegment', {
        projectId, segmentId: segment.id, target, expectedRevision: segment.revision,
      })
      if (!result.ok) {
        setNotice(result.error.message)
        return result.error.code === 'REVISION_CONFLICT' ? 'conflict' : 'failed'
      }
      updateRow(result.data)
      setRowSignalRefresh((value) => value + 1)
      void refreshSummary().catch((error: unknown) => setNotice(String(error)))
      setNotice(t("译文已保存"))
      return 'saved'
    } catch (error) { setNotice(String(error)); return 'failed' }
  }, [projectId, refreshSummary, updateRow])

  const mutateStage = React.useCallback(async (segment: LinguistSegmentInfo, confirm: boolean) => {
    const requestRevision = navigationRevision.current
    try {
      const latest = await reloadRow(segment.id)
      if (confirm && latest.currentStageState === 'confirmed') return
      if (!confirm && latest.currentStageState !== 'confirmed') return
      const next = await required<LinguistSegmentInfo>(confirm ? 'linguistCatConfirmStage' : 'linguistCatUnconfirmStage', {
        projectId, segmentId: latest.id, expectedRevision: latest.revision,
      })
      updateRow(next)
      setRowSignalRefresh((value) => value + 1)
      void refreshSummary().catch((error: unknown) => setNotice(String(error)))
      setNotice(confirm ? t(stageCompletionLabel(workflowStage)) : t("已撤销当前阶段确认"))
      if (confirm && dataset !== undefined && navigationRevision.current === requestRevision && currentSignature.current === dataset.signature) {
        const page = await required<LinguistCatQueryResult>('linguistCatQuery', {
          projectId, assetId, currentStageState: stageFilter || undefined,
          search: search || undefined, limit: PAGE_SIZE, offset: 0, includeIndex: true,
        })
        if (navigationRevision.current !== requestRevision || currentSignature.current !== dataset.signature) return
        const indexed: Dataset = { signature: dataset.signature, total: page.total, ids: page.segmentIds, rows: mergeIndexedPage(new Map(), 0, page.segments) }
        const currentIndex = indexed.ids.indexOf(segment.id)
        const following = new Set(dataset.ids.slice(dataset.ids.indexOf(segment.id) + 1))
        const followingIndex = indexed.ids.findIndex((id) => following.has(id))
        const index = currentIndex >= 0 ? currentIndex : followingIndex >= 0 ? followingIndex - 1 : indexed.total
        let candidateRows = new Map(indexed.rows)
        confirmedDatasetRevision.current += 1
        setDataset(indexed)
        let nextRow = findNextEditableRow(candidateRows, index, next.assetId, indexed.total)
        while (nextRow.kind === 'load') {
          const offset = Math.floor(nextRow.index / PAGE_SIZE) * PAGE_SIZE
          const segments = await loadPage(offset, indexed)
          if (navigationRevision.current !== requestRevision || currentSignature.current !== dataset.signature) return
          candidateRows = mergeIndexedPage(candidateRows, offset, segments)
          if (!candidateRows.has(nextRow.index)) { setNotice(t('当前批次和筛选范围内没有下一个可编辑句段')); return }
          nextRow = findNextEditableRow(candidateRows, index, next.assetId, indexed.total)
        }
        confirmedDatasetRevision.current += 1
        setDataset({ ...indexed, rows: candidateRows })
        if (nextRow.kind === 'found') { navigationRevision.current += 1; setSelectedId(indexed.ids[nextRow.index]); setFocusIndex(nextRow.index) }
        else setNotice(t('当前批次和筛选范围内没有下一个可编辑句段'))
      }
    } catch (error) { setNotice(String(error)) }
  }, [projectId, reloadRow, updateRow, refreshSummary, dataset, loadPage, workflowStage, assetId, stageFilter, search])

  const confirmSelected = async () => {
    const ids = [...selectedIds]
    if (ids.length === 0 || ids.length > PAGE_SIZE || bulkBusy) return
    setBulkBusy(true)
    try {
      const contexts = await Promise.all(ids.map((segmentId) => invoke<LinguistCatContextResult>('linguistCatGetContext', { projectId, segmentId })))
      const items = contexts.flatMap((result) => result.ok ? [{ segmentId: result.data.segment.id, expectedRevision: result.data.segment.revision }] : [])
      if (items.length === 0) { setNotice(t("所选句段均无法读取，未执行阶段确认")); return }
      const result = await required<LinguistCatConfirmStageBulkResult>('linguistCatConfirmStageBulk', { projectId, items })
      result.succeeded.forEach(updateRow)
      const failed = new Set([...contexts.flatMap((entry, index) => entry.ok ? [] : [ids[index]!]), ...result.failed.map((entry) => entry.segmentId)])
      setSelectedIds(failed)
      await refreshSummary()
      setNotice(`${t(stageCompletionLabel(workflowStage))} ${result.succeeded.length} ${t('段')}，${result.failed.length} ${t('段失败')}${result.failed.length ? `：${result.failed.slice(0, 3).map((entry) => `${entry.segmentId} ${entry.code}`).join('；')}` : ''}`)
    } catch (error) { setNotice(String(error)) }
    finally { setBulkBusy(false) }
  }

  const navigateToSegment = (id: string) => {
    navigationRevision.current += 1
    pendingNavigation.current = undefined
    const index = dataset?.ids.indexOf(id) ?? -1
    if (index >= 0) { setSelectedId(id); setFocusIndex(index); return }
    pendingNavigation.current = { id, signature: `${projectId}\0\0\0` }
    setAssetId(undefined)
    setStageFilter('')
    setSearch('')
    setReload((value) => value + 1)
  }

  const nextUntouched = async () => {
    if (jumpBusy) return
    setJumpBusy(true)
    const requestRevision = navigationRevision.current
    try {
      const [all, untouched] = await Promise.all([
        required<LinguistCatQueryResult>('linguistCatQuery', { projectId, assetId, limit: 1, includeIndex: true }),
        required<LinguistCatQueryResult>('linguistCatQuery', { projectId, assetId, currentStageState: 'untouched', limit: 1, includeIndex: true }),
      ])
      if (navigationRevision.current !== requestRevision) return
      const available = new Set(untouched.segmentIds)
      const current = all.segmentIds.indexOf(selectedId ?? '')
      const next = [...all.segmentIds.slice(current + 1), ...all.segmentIds.slice(0, current + 1)].find((id) => available.has(id))
      if (!next) { setNotice(t('当前范围没有待处理句段。')); return }
      pendingNavigation.current = { id: next, signature: `${projectId}\0${assetId ?? ''}\0\0` }
      setStageFilter('')
      setSearch('')
      setReload((value) => value + 1)
    } catch (cause) { setNotice(String(cause)) }
    finally { setJumpBusy(false) }
  }

  const nextQa = async () => {
    if (jumpBusy) return
    setJumpBusy(true)
    const requestRevision = navigationRevision.current
    try {
      const [all, first] = await Promise.all([
        required<LinguistCatQueryResult>('linguistCatQuery', { projectId, assetId, limit: 1, includeIndex: true }),
        required<LinguistCatListQaFindingsResult>('linguistCatListQaFindings', { projectId, assetId, status: 'open', limit: 200, offset: 0 }),
      ])
      const pages = first.hasMore ? await Promise.all(Array.from({ length: Math.ceil(first.total / 200) - 1 }, (_, index) => required<LinguistCatListQaFindingsResult>('linguistCatListQaFindings', { projectId, assetId, status: 'open', limit: 200, offset: (index + 1) * 200 }))) : []
      if (navigationRevision.current !== requestRevision) return
      const bySegment = new Map([...first.items, ...pages.flatMap((page) => page.items)].map((finding) => [finding.segmentId, finding]))
      const current = all.segmentIds.indexOf(selectedId ?? '')
      const next = [...all.segmentIds.slice(current + 1), ...all.segmentIds.slice(0, current + 1)].find((id) => bySegment.has(id))
      if (!next) { setNotice(t('当前范围没有开放的 QA 问题。')); return }
      setQaNavigation({ findingId: bySegment.get(next)!.id, segmentId: next })
      setDock('qa')
      setDockOpen(true)
      navigateToSegment(next)
    } catch (cause) { setNotice(String(cause)) }
    finally { setJumpBusy(false) }
  }

  const openQaForRow = (segmentId: string) => {
    setQaNavigation({ segmentId })
    setDock('qa')
    setDockOpen(true)
    navigateToSegment(segmentId)
  }
  const openProposalForRow = (proposal: LinguistProposalInfo) => {
    setProposalNavigation(proposal.id)
    setDock('proposals')
    setDockOpen(true)
    navigateToSegment(proposal.segmentId)
  }
  const reviewProposalForRow = async (segment: LinguistSegmentInfo, proposal: LinguistProposalInfo, action: 'accept' | 'reject') => {
    if (reviewingProposals.current.has(proposal.id)) return
    reviewingProposals.current.add(proposal.id)
    setReviewingIds(new Set(reviewingProposals.current))
    try {
      await required(action === 'accept' ? 'linguistProposalsAccept' : 'linguistProposalsReject', {
        projectId, proposalId: proposal.id, expectedRevision: segment.revision, idempotencyKey: crypto.randomUUID(),
      })
      await reloadRow(segment.id)
      await refreshSummary()
      setRowSignalRefresh((value) => value + 1)
      setMutation((value) => value + 1)
      setNotice(action === 'accept' ? t('建议已接受') : t('建议已拒绝'))
    } catch (cause) { setNotice(String(cause)); setRowSignalRefresh((value) => value + 1) }
    finally { reviewingProposals.current.delete(proposal.id); setReviewingIds(new Set(reviewingProposals.current)) }
  }

  React.useEffect(() => {
    if (navigation === undefined) return
    navigationRevision.current += 1
    pendingNavigation.current = undefined
    if (navigation.dock) { setDock(navigation.dock); setDockOpen(true) }
    if (navigation.inspector) { setInspectorOpen(true); if (compactLayout.current) setAssetNavigatorOpen(false) }
    if (navigation.segmentId) {
      pendingNavigation.current = { id: navigation.segmentId, signature: `${projectId}\0\0\0` }
      setAssetId(undefined)
      setStageFilter('')
      setSearch('')
      setReload((value) => value + 1)
    } else if (navigation.assetId) {
      setAssetId(navigation.assetId)
      setStageFilter('')
      setSearch('')
    } else if (navigation.dock === 'qa' || navigation.dock === 'proposals') {
      setAssetId(undefined)
      setSelectedId(undefined)
      setSelectedIds(new Set())
      setQaNavigation(undefined)
      setProposalNavigation(undefined)
      setStageFilter('')
      setSearch('')
    }
  }, [navigation])

  if (loadError && project === undefined) return <div role="alert" className={styles.center}>{loadError}<Button variant="outline" size="sm" onClick={() => { setLoadError(''); setOpenRetry((value) => value + 1) }}>{t("重试")}</Button></div>
  if (project === undefined) return <div role="status" className={styles.center}>{t("正在打开本地化项目…")}</div>

  return <section ref={workbenchRef} className={styles.workbench} aria-label={`${project.name} ${t('CAT 工作台')}`} onKeyDown={(event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !compactLayout.current) return
    if (inspectorOpen) { setInspectorOpen(false); displayTrigger.current?.focus(); event.preventDefault() }
    else if (assetNavigatorOpen) { setAssetNavigatorOpen(false); navigationTrigger.current?.focus(); event.preventDefault() }
  }}>
    <header className={styles.header}>
      <div className={styles.title}>
        <div className={styles.projectIdentity}><span className={styles.workbenchLabel}>{t('CAT 工作台')}</span><strong title={project.name}>{project.name}</strong></div>
        <span className={styles.languagePair}>{project.sourceLocale}<span aria-hidden="true">→</span>{project.targetLocale}</span>
        <span className={styles.stageBadge} title={t('当前阶段')}>{t(stageName(workflowStage))}</span>
      </div>
      <div className={styles.controls}>
        <Tooltip portal label={t('批次导航')}><Button className={styles.iconButton} ref={navigationTrigger} variant="ghost" size="sm" aria-label={t('批次导航')} aria-expanded={assetNavigatorOpen} onClick={() => { setAssetNavigatorOpen((value) => !value); if (compactLayout.current) setInspectorOpen(false) }}><IconPanelLeftOutlineRegular size={16} /></Button></Tooltip>
        <select className={styles.batchSelect} aria-label={t("工作批次")} value={assetId ?? ''} onChange={(event) => setAssetId(event.target.value || undefined)}>
          <option value="">{t("全部批次")}</option>
          {summary?.assets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.filename}</option>)}
        </select>
        <Input className={styles.search} aria-label={t("搜索源文或译文")} placeholder={t("搜索句段")} value={search} onChange={(event) => setSearch(event.target.value)} />
        <select className={styles.statusSelect} aria-label={t("阶段筛选")} value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>
          <option value="">{t("全部状态")}</option>{stageFilterOptions(workflowStage).map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
        </select>
        <Tooltip portal label={t(nextStageItemLabel(workflowStage))}><Button className={styles.iconButton} variant="outline" size="sm" aria-label={t(nextStageItemLabel(workflowStage))} disabled={jumpBusy} onClick={() => void nextUntouched()}><IconChevronDownOutlineRegular size={16} /></Button></Tooltip>
        <Menu portal open={displayOpen} onClose={() => setDisplayOpen(false)} anchor={<Tooltip portal label={t('更多工作台操作')}><Button className={styles.iconButton} ref={displayTrigger} variant="ghost" size="sm" aria-label={t('更多工作台操作')} aria-haspopup="menu" aria-expanded={displayOpen} onClick={() => setDisplayOpen((value) => !value)}><IconEllipsisOutlineRegular size={16} /></Button></Tooltip>} selectedIds={[...(inspectorOpen ? ['inspector'] : []), ...(dockOpen ? ['dock'] : [])]} items={[
          { id: 'refresh', label: t('刷新') },
          { id: 'next-qa', label: t('下一个 QA 问题'), disabled: jumpBusy },
          { id: 'inspector', label: t('参考检查器') },
          { id: 'dock', label: t('辅助区') },
        ]} onSelect={(id) => {
          if (id === 'refresh') setReload((value) => value + 1)
          else if (id === 'next-qa') void nextQa()
          else if (id === 'inspector') { setInspectorOpen((value) => !value); if (compactLayout.current) setAssetNavigatorOpen(false) }
          else if (id === 'dock') setDockOpen((value) => !value)
          setDisplayOpen(false)
        }} />
      </div>
      {(selectedIds.size > 0 || agentReference) && <div className={styles.selectionActions}>
        {selectedIds.size > 0 && <Button variant="primary" size="sm" disabled={bulkBusy || project.archivedAt !== undefined || selectedIds.size > PAGE_SIZE} title={selectedIds.size > PAGE_SIZE ? t("一次最多确认 200 段") : undefined} onClick={() => void confirmSelected()}>{t(stageActionLabel(workflowStage))} {selectedIds.size} {t("段")}</Button>}
        <Button variant="outline" size="sm" onClick={() => void sendScopedAgentTask('请按当前岗位职责处理本次明确勾选或引用的句段。先读取完整必要上下文、当前 Target、术语与结构约束；仅把实际查看并裁定的句段计入本轮覆盖，逐项报告未解决问题。').catch((error: unknown) => setNotice(String(error)))}>{t('让 Agent 处理所选')}</Button>
      </div>}
    </header>
    {agentReference && <div className={styles.agentReference} role="status" title={agentReference.segmentId}>{t('已为 Agent 引用句段')} {`#${agentReference.ordinal + 1}`}<Button variant="outline" size="sm" onClick={() => setAgentReference(undefined)}>{t('移除引用')}</Button></div>}
    {!project.archivedAt && <UnknownTagNotice key={projectId} projectId={projectId} scanRevision={`${project.updatedAt}|${summary?.assets.map((asset) => `${asset.assetId}:${asset.sourceSha256}`).sort().join('|') ?? ''}`} onView={() => { setDock('settings'); setDockOpen(true) }} onSendAgentTask={sendScopedAgentTask} />}
    <div ref={bodyRef} className={styles.body}>
      {assetNavigatorOpen && <nav id={`linguist-batches-${sessionId}`} className={styles.assets} style={{ width: Math.min(assetNavigatorWidth, assetMaximum) }} aria-label={t("批次导航")}>
        <div className={styles.assetContents}>
        <div className={styles.contextHeading}><strong>{t("工作批次")} {summary?.assetCount ?? ''}</strong><Button variant="ghost" size="sm" aria-label={t("收起批次导航")} onClick={() => { setAssetNavigatorOpen(false); navigationTrigger.current?.focus() }}>×</Button></div>
        <Button variant="outline" size="sm" onClick={() => { setDock('assets'); setDockOpen(true) }}>{t('管理批次')}</Button>
        <Input aria-label={t('搜索批次')} placeholder={t('搜索批次')} value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} />
        {summary?.assets.filter((asset) => asset.filename.toLocaleLowerCase().includes(assetSearch.trim().toLocaleLowerCase())).map((asset: LinguistAssetInfo) => <div key={asset.assetId} className={styles.assetEntry} data-active={assetId === asset.assetId}><Button variant="ghost" size="sm" className={styles.asset} title={asset.filename} onClick={() => setAssetId(asset.assetId)}>
          <span>{asset.filename}</span>
        </Button><div className={styles.assetDetails}><small>{t(stageCompletionLabel(workflowStage))} {asset.currentStageCounts.confirmed}/{asset.segmentCount}</small><Button variant="outline" size="sm" aria-label={t('预览批次 {filename}', { filename: asset.filename })} onClick={() => onOpenBatchPreview(asset.assetId)}>{t('预览')}</Button></div></div>)}
        {summary?.assets.length === 0 && <p>{t("尚无批次。请在“资料”中导入文件。")}</p>}
        {summary && summary.assets.length > 0 && !summary.assets.some((asset) => asset.filename.toLocaleLowerCase().includes(assetSearch.trim().toLocaleLowerCase())) && <p>{t('没有匹配的批次')}</p>}
        </div>
        <Splitter orientation="vertical" label={t('调整批次导航宽度')} controls={`linguist-batches-${sessionId}`} value={Math.min(assetNavigatorWidth, assetMaximum)} minimum={180} maximum={assetMaximum} defaultValue={240} onChange={setAssetNavigatorWidth} />
      </nav>}
      <div className={styles.gridColumn}>
        {loading && dataset === undefined ? <div role="status" className={styles.center}>{t("正在读取句段…")}</div>
          : dataset?.total === 0 ? <div className={styles.center}>{summary?.assetCount === 0 ? <div>
            <p>{t('尚无批次。请在“资料”中导入文件。')}</p>
            {!project.archivedAt && <Button variant="outline" size="sm" onClick={() => { setDock('assets'); setDockOpen(true) }}>{t('导入批次与资料')}</Button>}
          </div> : t("没有匹配的句段。可切换批次或筛选条件。")}</div>
            : dataset && <SegmentRows data={dataset} workflowStage={workflowStage} archived={project.archivedAt !== undefined} tagProfile={project.tagProfile} selectedId={selectedId} selectedIds={selectedIds} signals={rowSignals} reviewingIds={reviewingIds} focusIndex={focusIndex} drafts={editorState.drafts} editingIdAtom={editorState.editingId} onVisibleRange={(start, end) => {
              setVisibleRange((current) => current.start === start && current.end === end ? current : { start, end })
              for (const offset of pageOffsetsForRange(start, end, PAGE_SIZE)) void loadPage(offset, dataset).catch((error: unknown) => setNotice(String(error)))
            }} onOpenQa={openQaForRow} onOpenProposal={openProposalForRow} onReviewProposal={reviewProposalForRow} onSelect={(id) => {
              navigationRevision.current += 1
              pendingNavigation.current = undefined
              setSelectedId(id)
              setFocusIndex((current) => current !== undefined && dataset.ids[current] === id ? current : undefined)
            }} onToggleSelected={(id) => setSelectedIds((current) => {
              const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next
            })} onReferenceAgent={(segment) => setAgentReference({ segmentId: segment.id, assetId: segment.assetId, ordinal: segment.ordinal })} onFocusSettled={(index) => setFocusIndex((current) => current === index ? undefined : current)} onSave={save} onReload={reloadRow} onConfirm={(segment) => mutateStage(segment, true)} onUnconfirm={(segment) => mutateStage(segment, false)} onEditorHandleChange={handleEditorChange} />}
      </div>
      {inspectorOpen && <aside id={`linguist-inspector-${sessionId}`} className={styles.inspector} style={{ width: Math.min(inspectorWidth, inspectorMaximum) }} aria-label={t("句段参考检查器")}><Splitter orientation="vertical" direction={-1} label={t('调整参考检查器宽度')} controls={`linguist-inspector-${sessionId}`} value={Math.min(inspectorWidth, inspectorMaximum)} minimum={240} maximum={inspectorMaximum} defaultValue={320} onChange={setInspectorWidth} /><div className={styles.inspectorContents}><div className={styles.contextHeading}><strong>{t("参考检查器")}</strong><Button variant="ghost" size="sm" aria-label={t("收起参考检查器")} onClick={() => { setInspectorOpen(false); displayTrigger.current?.focus() }}>×</Button></div><ContextPanel projectId={projectId} segmentId={active?.id} editorHandle={active?.id === editor?.segmentId ? editor?.handle : undefined} archived={project.archivedAt !== undefined} mutation={mutation} onOpenTerms={() => { setDock('references'); setDockOpen(true) }} /></div></aside>}
    </div>
    <div ref={dockRef} id={`linguist-dock-${sessionId}`} className={dockOpen ? styles.dock : styles.dockCollapsed} style={dockOpen ? { height: Math.min(dockHeight, dockMaximum) } : undefined}>
      {dockOpen && <Splitter orientation="horizontal" direction={-1} label={t('调整辅助区高度')} controls={`linguist-dock-${sessionId}`} value={Math.min(dockHeight, dockMaximum)} minimum={80} maximum={dockMaximum} defaultValue={240} onChange={setDockHeight} />}
      <div className={styles.dockToolbar}><div role="tablist" aria-label={t("工作台面板")} className={styles.dockTabs}>{dockItems.map((item, index) => <Button key={item.id} variant="ghost" size="sm" role="tab" aria-selected={dock === item.id && dockOpen} tabIndex={dock === item.id ? 0 : -1} className={dock === item.id && dockOpen ? styles.dockActive : styles.dockTab} onClick={() => { setDock(item.id); setDockOpen(true) }} onKeyDown={(event) => {
        const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? dockItems.length - 1 : event.key === 'ArrowRight' ? (index + 1) % dockItems.length : event.key === 'ArrowLeft' ? (index + dockItems.length - 1) % dockItems.length : -1
        if (nextIndex < 0) return
        event.preventDefault()
        setDock(dockItems[nextIndex]!.id)
        setDockOpen(true)
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus()
      }}>{t(item.label)}</Button>)}</div><Tooltip portal label={t(dockOpen ? '收起辅助区' : '展开辅助区')}><Button className={styles.dockToggle} variant="ghost" size="sm" aria-label={t(dockOpen ? '收起辅助区' : '展开辅助区')} aria-expanded={dockOpen} onClick={() => setDockOpen((value) => !value)}><IconChevronDownOutlineRegular size={16} /></Button></Tooltip></div>
      {dockOpen && <div role="tabpanel" className={styles.dockBody}>
        {dock === 'qa' && <QaPanel mutation={mutation} projectId={projectId} assetId={assetId} segmentId={active?.id} focusFindingId={qaNavigation?.findingId ?? (navigation?.dock === 'qa' ? navigation.findingId : undefined)} focusSegmentId={qaNavigation?.segmentId ?? (navigation?.dock === 'qa' ? navigation.segmentId : undefined)} archived={project.archivedAt !== undefined} onNavigate={navigateToSegment} onChanged={() => setMutation((value) => value + 1)} />}
        {dock === 'proposals' && <ProposalPanel mutation={mutation} projectId={projectId} assetId={assetId} segmentIds={selectedIds.size > 0 ? [...selectedIds] : active ? [active.id] : []} focusProposalId={proposalNavigation ?? (navigation?.dock === 'proposals' ? navigation.proposalId : undefined)} archived={project.archivedAt !== undefined} onNavigate={navigateToSegment} onChanged={() => setMutation((value) => value + 1)} />}
        {dock === 'references' && <ReferencePanel mutation={mutation} projectId={projectId} assetId={assetId} segmentIds={selectedIds.size > 0 ? [...selectedIds] : active ? [active.id] : []} archived={project.archivedAt !== undefined} onNavigate={navigateToSegment} onChanged={() => setMutation((value) => value + 1)} onSendAgentTask={sendScopedAgentTask} />}
        {dock === 'assets' && <AssetsPanel mutation={mutation} projectId={projectId} segmentId={active?.id} focusDocId={navigation?.dock === 'assets' ? navigation.docId : undefined} archived={project.archivedAt !== undefined} onChanged={() => setMutation((value) => value + 1)} onSendAgentTask={sendScopedAgentTask} onOpenBatchPreview={onOpenBatchPreview} />}
        {dock === 'delivery' && <DeliveryPanel mutation={mutation} projectId={projectId} assets={summary?.assets ?? []} archived={project.archivedAt !== undefined} />}
        {dock === 'run' && <RunPanel projectId={projectId} sessionId={sessionId} onCancelRun={onCancelRun} onOpenSession={onOpenSession} jobUpdates={jobUpdates} assetId={assetId} selectedSegmentIds={[...selectedIds]} uiRevision={uiRevision.current} workflowStage={workflowStage} archived={project.archivedAt !== undefined} mutation={mutation} onChanged={() => setMutation((value) => value + 1)} />}
        {dock === 'settings' && <ProjectSettingsPanel mutation={mutation} onOpenHistory={(dock) => requestCatNavigation({ sessionId, projectId, dock })} project={project} hasBatches={summary?.assetCount !== 0} sessionId={sessionId} capabilities={capabilities} onChanged={() => setMutation((value) => value + 1)} />}
      </div>}
    </div>
    <CatStatusBar projectId={projectId} assetId={assetId} summary={summary} active={active} selectedCount={selectedIds.size} revision={`${mutation}:${reload}`} />
    {notice && <div role="status" className={styles.notice}>{notice}<Button variant="ghost" size="sm" aria-label={t("关闭提示")} onClick={() => setNotice('')}>×</Button></div>}
  </section>
}

interface RowsProps {
  data: Dataset; workflowStage: NonNullable<LinguistProjectInfo['workflowStage']>; archived: boolean; tagProfile: LinguistProjectInfo['tagProfile'];
  selectedId?: string; selectedIds: ReadonlySet<string>; signals: ReadonlyMap<string, RowSignal>; reviewingIds: ReadonlySet<string>; focusIndex?: number;
  drafts: Map<string, PrimitiveAtom<TargetEditorDraft | undefined>>;
  editingIdAtom: PrimitiveAtom<string | undefined>;
  onVisibleRange: (start: number, end: number) => void; onSelect: (id: string) => void;
  onToggleSelected: (id: string) => void; onFocusSettled: (index: number) => void;
  onReferenceAgent: (segment: LinguistSegmentInfo) => void;
  onOpenQa: (segmentId: string) => void;
  onOpenProposal: (proposal: LinguistProposalInfo) => void;
  onReviewProposal: (segment: LinguistSegmentInfo, proposal: LinguistProposalInfo, action: 'accept' | 'reject') => Promise<void>;
  onSave: (segment: LinguistSegmentInfo, target: string) => Promise<TargetSaveResult>;
  onReload: (id: string) => Promise<LinguistSegmentInfo>;
  onConfirm: (segment: LinguistSegmentInfo) => Promise<void>;
  onUnconfirm: (segment: LinguistSegmentInfo) => Promise<void>;
  onEditorHandleChange: (segmentId: string, handle: TargetEditorHandle | undefined) => void;
}

function SegmentRows(props: RowsProps): React.ReactElement {
  const t = useT()
  const scroller = React.useRef<HTMLDivElement>(null)
  const pendingRowFocus = React.useRef<string>()
  if (pendingRowFocus.current !== props.selectedId) pendingRowFocus.current = undefined
  const [editingId, setEditingId] = useAtom(props.editingIdAtom)
  const currentEditingId = React.useRef(editingId)
  currentEditingId.current = editingId
  const [menuId, setMenuId] = React.useState<string>()
  const handleCallbacks = React.useRef(new Map<string, (handle: TargetEditorHandle | undefined) => void>())
  const virtualizer = useVirtualizer({ count: props.data.total, getScrollElement: () => scroller.current, estimateSize: () => 64, overscan: 8, getItemKey: (index) => virtualRowKey(props.data.ids, index) })
  const items = virtualizer.getVirtualItems()
  React.useEffect(() => {
    if (items.length > 0) props.onVisibleRange(items[0]!.index, items.at(-1)!.index)
  }, [items[0]?.index, items.at(-1)?.index, props.onVisibleRange])
  React.useEffect(() => {
    if (props.focusIndex !== undefined && props.data.ids[props.focusIndex] === props.selectedId) virtualizer.scrollToIndex(props.focusIndex)
  }, [props.focusIndex, props.selectedId, props.data.ids, virtualizer])
  React.useEffect(() => {
    const index = props.focusIndex
    if (index === undefined) return
    if (props.data.ids[index] !== props.selectedId) { props.onFocusSettled(index); return }
    if (!props.data.rows.has(index)) return
    const row = scroller.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)
    if (!row) return
    if (!row.contains(document.activeElement)) row.focus({ preventScroll: true })
    props.onFocusSettled(index)
  }, [props.focusIndex, props.selectedId, props.data.ids, props.data.rows, items[0]?.index, items.at(-1)?.index, props.onFocusSettled])
  return <div className={styles.grid} role="grid" aria-label={t("句段编辑器")} aria-rowcount={props.data.total + 1} ref={scroller} onScroll={() => setMenuId(undefined)}>
    <div className={styles.gridHeading} role="row" aria-rowindex={1}><span role="columnheader">#</span><span role="columnheader">{t('源文')}</span><span role="columnheader">{t('译文')}</span><span role="columnheader">{t('操作')}</span></div>
    <div className={styles.gridInner} style={{ height: virtualizer.getTotalSize() }}>
      {items.map((item) => {
        const segment = props.data.rows.get(item.index)
        const id = props.data.ids[item.index]!
        const draftKey = id
        let draft = props.drafts.get(draftKey)
        let onHandleChange = handleCallbacks.current.get(id)
        if (!onHandleChange) {
          onHandleChange = (handle) => props.onEditorHandleChange(id, handle)
          handleCallbacks.current.set(id, onHandleChange)
        }
        if (segment !== undefined && draft === undefined) {
          draft = atom<TargetEditorDraft | undefined>({ state: createTargetDraftState(segment.target), baseTarget: segment.target, baseRevision: segment.revision, saving: false, conflict: false, resolvingConflict: false })
          props.drafts.set(draftKey, draft)
        }
        const signal = props.signals.get(id)
        return <div key={id} ref={(node) => {
          virtualizer.measureElement(node)
          if (node && segment !== undefined && pendingRowFocus.current === id && props.selectedId === id) {
            pendingRowFocus.current = undefined
            node.focus({ preventScroll: true })
          }
        }} data-index={item.index} className={id === props.selectedId ? styles.segmentSelected : styles.segment} style={{ transform: `translateY(${item.start}px)` }} role="row" aria-rowindex={item.index + 2} aria-selected={id === props.selectedId} tabIndex={id === props.selectedId || (props.selectedId === undefined && item.index === 0) ? 0 : -1} onFocus={() => props.onSelect(id)} onKeyDown={(event) => {
          if ((event.target as HTMLElement).closest('[data-target-editor]')) return
          const action = gridRowKeyAction({ key: event.key, currentIndex: item.index, total: props.data.total, pageSize: 8, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey })
          if (action === null) return
          if (event.target !== event.currentTarget && action.type !== 'focus') return
          event.preventDefault()
          if (action.type === 'focus') {
            const nextId = props.data.ids[action.index]!
            if (action.index !== item.index) pendingRowFocus.current = nextId
            virtualizer.scrollToIndex(action.index)
            props.onSelect(nextId)
          }
          else if (action.type === 'toggle-selection') props.onToggleSelected(id)
          else if (segment && !segment.locked && !props.archived) setEditingId(id)
        }}>
          {segment === undefined ? <span role="status">{t("正在读取 #")}{item.index + 1}…</span> : <>
            <div className={styles.rowMeta} role="gridcell"><Checkbox label={`#${segment.ordinal + 1}`} title={t('选择句段 {number}', { number: segment.ordinal + 1 })} checked={props.selectedIds.has(id)} onChange={() => props.onToggleSelected(id)} />{segment.locked && <span title={t("锁定")}>{t("锁定")}</span>}<span title={segmentStatusBadgeTitle(props.workflowStage, segment.currentStageState ?? 'untouched', segment.status, Boolean(segment.target), t)}>{t(stageProgressLabel(props.workflowStage, segment.currentStageState ?? 'untouched', Boolean(segment.target)))}</span>{signal?.qaCount && signal.highestSeverity ? <Button variant="ghost" size="sm" onClick={() => props.onOpenQa(id)} title={`${t('查看当前句段 QA')} · ${t(qaSeverityLabel(signal.highestSeverity))}`}>QA · {t(qaTierLabel(qaSeverityTier(signal.highestSeverity)))} · {signal.qaCount}</Button> : null}{signal?.proposal && <Button variant="ghost" size="sm" onClick={() => props.onOpenProposal(signal.proposal!)}>{t('待审建议')}</Button>}</div>
            <div className={styles.source} role="gridcell" data-label={t("源文")} lang={segment.sourceLocale} dir="auto">{splitProtectedText(segment.source, props.tagProfile).map((part, index) => <span key={index} className={part.kind === 'text' ? undefined : styles.inlineTag}>{part.value}</span>)}</div>
            <div className={styles.target} role="gridcell" data-label={t("译文")} lang={segment.targetLocale} dir="auto">
              {editingId === id ? <TargetEditor draftAtom={draft!} index={segment.ordinal} segment={segment} archived={props.archived} confirmLabel={t(stageActionLabel(props.workflowStage))} tagProfile={props.tagProfile} onCancel={() => { pendingRowFocus.current = id; props.drafts.delete(id); setEditingId(undefined) }} onSave={(target) => props.onSave(segment, target)} onReload={() => props.onReload(id)} onSaved={(advance) => { if (props.drafts.get(id) === draft) { if (currentEditingId.current === id && !advance) pendingRowFocus.current = id; props.drafts.delete(id); setEditingId((current) => current === id ? undefined : current) } if (advance) void props.onConfirm(segment) }} onHandleChange={onHandleChange} />
                : <button type="button" className={styles.targetButton} disabled={segment.locked || props.archived} onClick={() => {
                  props.onSelect(id)
                  setEditingId(id)
                }} onFocus={() => props.onSelect(id)}>{segment.target || t("编辑译文…")}</button>}
            </div>
            <div className={styles.rowActions} role="gridcell">
              {segment.currentStageState !== 'confirmed' && <Tooltip portal label={t(stageActionLabel(props.workflowStage))}><Button className={styles.iconButton} variant="outline" size="sm" aria-label={t('{action}句段 {number}', { action: t(stageActionLabel(props.workflowStage)), number: segment.ordinal + 1 })} onClick={() => void props.onConfirm(segment)} disabled={props.archived || segment.locked}><IconCheckOutlineRegular size={16} /></Button></Tooltip>}
              <Menu portal open={menuId === id} onClose={() => setMenuId(undefined)} anchor={<Tooltip portal label={t('句段 {number} 的更多操作', { number: segment.ordinal + 1 })}><Button className={styles.iconButton} variant="ghost" size="sm" aria-label={t('句段 {number} 的更多操作', { number: segment.ordinal + 1 })} aria-haspopup="menu" aria-expanded={menuId === id} onClick={() => setMenuId((current) => current === id ? undefined : id)}><IconEllipsisOutlineRegular size={16} /></Button></Tooltip>} items={[
                { id: 'reference', label: t('为 Agent 引用') },
                ...(signal?.proposal ? [
                  { id: 'open-proposal', label: t('待审建议') },
                  { id: 'accept', label: t('接受'), disabled: props.archived || props.reviewingIds.has(signal.proposal.id) || segment.locked || signal.proposal.baseRevision !== segment.revision },
                  { id: 'reject', label: t('拒绝建议'), disabled: props.archived || props.reviewingIds.has(signal.proposal.id) },
                ] : []),
                ...(segment.currentStageState === 'confirmed' ? [{ id: 'unconfirm', label: t('撤销确认'), disabled: props.archived }] : []),
              ]} onSelect={(action) => {
                setMenuId(undefined)
                if (action === 'reference') props.onReferenceAgent(segment)
                else if (action === 'open-proposal') props.onOpenProposal(signal!.proposal!)
                else if (action === 'accept' || action === 'reject') void props.onReviewProposal(segment, signal!.proposal!, action)
                else if (action === 'unconfirm') void props.onUnconfirm(segment)
              }} />
            </div>
          </>}
        </div>
      })}
    </div>
  </div>
}

function ContextPanel({ projectId, segmentId, editorHandle, archived, mutation, onOpenTerms }: { projectId: string; segmentId?: string; editorHandle?: TargetEditorHandle; archived: boolean; mutation: number; onOpenTerms: () => void }): React.ReactElement {
  const t = useT()
  const [data, setData] = React.useState<LinguistCatContextResult>()
  const [docs, setDocs] = React.useState<LinguistContextDocInfo[]>([])
  const [allDocs, setAllDocs] = React.useState<LinguistContextDocInfo[]>([])
  const [styleRules, setStyleRules] = React.useState<LinguistStyleGuideRuleInfo[]>([])
  const [voiceProfiles, setVoiceProfiles] = React.useState<LinguistVoiceProfileInfo[]>([])
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [preview, setPreview] = React.useState<PreviewRequest>()
  const [error, setError] = React.useState('')
  const [actionError, setActionError] = React.useState('')
  const [speaker, setSpeaker] = React.useState('')
  const [textType, setTextType] = React.useState('')
  const [note, setNote] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [refresh, setRefresh] = React.useState(0)
  React.useEffect(() => {
    if (segmentId === undefined) { setData(undefined); return }
    let live = true
    setData((current) => current?.segment.id === segmentId ? current : undefined)
    Promise.all([
      required<LinguistCatContextResult>('linguistCatGetContext', { projectId, segmentId }),
      required<LinguistAssetsQueryResult>('linguistAssetsQuery', { projectId, kind: 'contextDocs', segmentId, limit: 200, offset: 0 }),
      required<LinguistAssetsQueryResult>('linguistAssetsQuery', { projectId, kind: 'contextDocs', limit: 200, offset: 0 }),
      required<LinguistAssetsQueryResult>('linguistAssetsQuery', { projectId, kind: 'styleGuideRules', limit: 200, offset: 0 }),
      required<LinguistAssetsQueryResult>('linguistAssetsQuery', { projectId, kind: 'voiceProfiles', limit: 200, offset: 0 }),
    ]).then(([next, linked, contextDocs, style, voice]) => { if (live) { setData(next); setDocs(linked.items.filter((item): item is LinguistContextDocInfo => 'originalFilename' in item)); setAllDocs(contextDocs.items.filter((item): item is LinguistContextDocInfo => 'originalFilename' in item)); setStyleRules(style.items.filter((item): item is LinguistStyleGuideRuleInfo => 'ruleText' in item)); setVoiceProfiles(voice.items.filter((item): item is LinguistVoiceProfileInfo => 'speaker' in item)); setError('') } }).catch((cause: unknown) => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [projectId, segmentId, mutation, refresh])
  const candidates = allDocs.filter((item) => !docs.some((doc) => doc.id === item.id))
  const setLink = async (docId: string, linked: boolean) => {
    if (!segmentId || archived) return
    try { await required('linguistAssetsSetContextDocSegmentLink', { projectId, docId, segmentId, linked }); setRefresh((value) => value + 1) }
    catch (cause) { setActionError(String(cause)) }
  }
  const applyReference = (target: string, action: 'replace' | 'insert') => {
    if (!editorHandle || archived || data?.segment.locked) return
    const applied = action === 'replace' ? editorHandle.replace(target) : editorHandle.insert(target)
    if (applied) { editorHandle.focus(); setActionError('') }
    else setActionError(t('参考译文未写入草稿；请核对 Tag、锁和输入法状态。'))
  }
  const addExemplar = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!segmentId || saving || archived) return
    setSaving(true)
    try {
      await required('linguistCatAddApprovedExemplar', { projectId, segmentId, speaker: speaker.trim(), textType: textType.trim(), ...(note.trim() ? { note: note.trim() } : {}) })
      setSpeaker(''); setTextType(''); setNote(''); setRefresh((value) => value + 1)
    } catch (cause) { setActionError(String(cause)) }
    finally { setSaving(false) }
  }
  if (!segmentId) return <p>{t("选择句段后查看 TM、术语、上下文和阶段历史。")}</p>
  if (error) return <div role="alert"><p>{error}</p><Button variant="outline" size="sm" onClick={() => { setError(''); setRefresh((value) => value + 1) }}>{t("重试")}</Button></div>
  if (!data) return <p role="status">{t("正在读取句段参考…")}</p>
  return <div className={styles.contextGrid}>
    {actionError && <p role="alert">{actionError}<Button variant="ghost" size="sm" onClick={() => setActionError('')}>{t('关闭提示')}</Button></p>}
    {!editorHandle && !archived && !data.segment.locked && <p className={styles.contextNotice}>{t('先打开当前句段的译文编辑器，再插入参考内容。')}</p>}
    {(archived || data.segment.locked) && <p className={styles.contextNotice}>{t(archived ? '项目已归档，仅可查看参考内容。' : '当前句段已锁定，仅可查看参考内容。')}</p>}
    <section><h3>{t("TM 匹配")}</h3>{data.tm.length === 0 ? <p>{t("没有匹配")}</p> : data.tm.map((item) => <article key={item.id}><strong>{item.matchedSource}</strong><p>{item.target}</p><small>{item.matchClass} · {Math.round(item.score)}% · {item.sourceLabel} · {item.safety === 'compatible' ? t('可复用') : t('需检查')}</small>{item.badges.length > 0 && <small>{item.badges.join(' · ')}</small>}{item.warnings.map((warning, index) => <small key={index} className={styles.contextWarning}>{warning}</small>)}{item.differences.length > 0 && <details><summary>{t('差异 {count} 项', { count: item.differences.length })}</summary>{item.differences.map((difference, index) => <p key={index}>{difference}</p>)}</details>}<div><Button variant="outline" size="sm" disabled={!editorHandle || archived || data.segment.locked} onClick={() => applyReference(item.target, 'replace')}>{t('替换草稿')}</Button><Button variant="outline" size="sm" disabled={!editorHandle || archived || data.segment.locked} onClick={() => applyReference(item.target, 'insert')}>{t('插入草稿')}</Button></div></article>)}</section>
    <section><h3>{t("术语")}</h3>{data.termMatches.length === 0 ? <p>{t("没有匹配")}</p> : data.termMatches.map((item) => <article key={item.id}>
      <strong>{item.term} → {item.translation}</strong>
      <small>{t(TERM_STATUS_LABELS[item.status])} · {t(item.matchType === 'exact' ? '精确匹配' : '包含匹配')} · {t(item.caseSensitive ? '区分大小写' : '不区分大小写')}{item.conflict ? ` · ${t('译文冲突')}` : ''}</small>
      {(item.module || item.category) && <small>{[item.module, item.category].filter(Boolean).join(' · ')}</small>}{item.note && <p>{item.note}</p>}
      <Button variant="outline" size="sm" disabled={!editorHandle || archived || data.segment.locked} onClick={() => applyReference(item.translation, 'insert')}>{t('插入草稿')}</Button>
    </article>)}</section>
    <details className={styles.contextSection}><summary>Style Guide · {styleRules.length}</summary>{styleRules.length === 0 && <p>{t("尚无风格规则")}</p>}{styleRules.map((item) => <article key={item.id}><strong>{item.groupKey ?? t('未指定分组')}</strong><p>{item.ruleText}</p>{item.goodExample && <small>{t('正例')}：{item.goodExample}</small>}{item.badExample && <small>{t('反例')}：{item.badExample}</small>}</article>)}</details>
    <details className={styles.contextSection}><summary>Voice · {voiceProfiles.length + data.approvedExemplars.length}</summary>{voiceProfiles.length + data.approvedExemplars.length === 0 && <p>{t("尚无角色声线或批准样例")}</p>}{voiceProfiles.map((item) => <article key={item.id}><strong>{item.speaker}</strong><p>{[item.register, item.textType, ...(item.toneMarkers ?? [])].filter(Boolean).join(' · ')}</p>{item.notes && <small>{item.notes}</small>}</article>)}{data.approvedExemplars.map((item) => <article key={item.id}><strong>{item.speaker} · {item.textType} · {t('批准样例')}</strong><p>{item.source} → {item.target}</p>{item.note && <small>{item.note}</small>}</article>)}</details>
    <details className={styles.contextSection}><summary>{t("上下文与历史")}</summary>{data.segment.context?.origin && <p>{t('来源')}：{data.segment.context.origin}</p>}{data.segment.context?.note && <p>{data.segment.context.note}</p>}{Object.entries(data.segment.context?.meta ?? {}).map(([key, value]) => <p key={key}>{key}：{value}</p>)}{allDocs.map((doc) => <p key={doc.id}>{doc.originalFilename} · {doc.note ?? (doc.hasTextExtract ? t('可阅读') : t('无文本抽取'))}</p>)}{data.stageEvents?.map((event, index) => <p key={index}>{event.stage} · {event.action} · {event.actor ?? t("未知操作人")} · {event.createdAt}</p>)}</details>
    <section><h3>{t('建议的证据来源')}</h3>{data.pendingProposal ? data.pendingProposal.evidenceRefs.length + data.pendingProposal.termRefs.length === 0 ? <p>{t('当前建议没有证据引用')}</p> : [...data.pendingProposal.evidenceRefs, ...data.pendingProposal.termRefs].map((reference, index) => <p key={`${reference}:${index}`}><code>{reference}</code> <Button variant="outline" size="sm" onClick={onOpenTerms}>{t('查看参考库')}</Button></p>) : <p>{t('当前句段没有待审建议')}</p>}</section>
    <section><div className={styles.contextHeading}><h3>{t("关联文档与图像")}</h3><Button variant="outline" size="sm" disabled={archived} onClick={() => setPickerOpen((value) => !value)}>{pickerOpen ? t('收起候选') : t('关联资料')}</Button></div>{docs.length === 0 && <p>{t("当前句段没有显式关联的资料。")}</p>}{docs.map((doc) => <article key={doc.id}><strong>{doc.originalFilename}</strong>{doc.note && <p>{doc.note}</p>}{doc.kind === 'image' && doc.previewUrl?.startsWith('/la/v1/files/') && <img className={styles.contextImage} alt={doc.originalFilename} src={doc.previewUrl} />}<div><Button variant="outline" size="sm" onClick={() => setPreview({ operation: 'linguistAssetsPreviewContextDoc', input: { projectId, docId: doc.id } })}>{t("预览原件")}</Button><Button variant="outline" size="sm" disabled={archived} onClick={() => void setLink(doc.id, false)}>{t("取消关联")}</Button></div></article>)}
      {pickerOpen && <div className={styles.contextCandidates}>{candidates.length === 0 ? <p>{t('没有可关联的 Context Doc。')}</p> : candidates.map((doc) => <p key={doc.id}>{doc.originalFilename} <Button variant="outline" size="sm" onClick={() => void setLink(doc.id, true)}>{t('关联')}</Button></p>)}</div>}
      {preview && <PreviewView request={preview} onClose={() => setPreview(undefined)} />}</section>
    {data.segment.currentStageState === 'confirmed' && <section><h3>{t("设为角色译例")}</h3><p>{t("使用当前已确认的 Source / Target。")}</p><form className={styles.exemplarForm} onSubmit={(event) => void addExemplar(event)}><Input required disabled={archived} aria-label={t("角色译例说话人")} placeholder={t("说话人")} value={speaker} onChange={(event) => setSpeaker(event.target.value)} /><Input required disabled={archived} aria-label={t("角色译例文本类型")} placeholder={t("文本类型")} value={textType} onChange={(event) => setTextType(event.target.value)} /><Input disabled={archived} aria-label={t("角色译例备注")} placeholder={t("备注")} value={note} onChange={(event) => setNote(event.target.value)} /><Button variant="outline" type="submit" size="sm" disabled={archived || saving || !speaker.trim() || !textType.trim()}>{t("保存译例")}</Button></form></section>}
  </div>
}
