import * as React from 'react'
import styles from './Workbench.module.css'

export function Splitter({ orientation, label, controls, value, minimum, maximum, defaultValue, direction = 1, onChange }: {
  orientation: 'horizontal' | 'vertical'
  label: string
  controls: string
  value: number
  minimum: number
  maximum: number
  defaultValue: number
  direction?: 1 | -1
  onChange: (value: number) => void
}): React.ReactElement {
  const drag = React.useRef<{ pointerId: number; origin: number; size: number; element: HTMLDivElement }>()
  const position = (event: React.PointerEvent) => orientation === 'vertical' ? event.clientX : event.clientY
  const resize = (next: number) => onChange(Math.round(Math.min(maximum, Math.max(minimum, next))))
  const finish = () => {
    const current = drag.current
    drag.current = undefined
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId)
  }
  React.useEffect(() => finish, [])
  return <div className={orientation === 'vertical' ? styles.splitterVertical : styles.splitterHorizontal}
    role="separator" tabIndex={0} aria-label={label} aria-controls={controls} aria-orientation={orientation}
    aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={value}
    onPointerDown={(event) => {
      if (event.button !== 0 || drag.current) return
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      const panel = event.currentTarget.parentElement!.getBoundingClientRect()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { pointerId: event.pointerId, origin: position(event), size: orientation === 'vertical' ? panel.width : panel.height, element: event.currentTarget }
    }}
    onPointerMove={(event) => {
      const current = drag.current
      if (current?.pointerId === event.pointerId) resize(current.size + direction * (position(event) - current.origin))
    }}
    onPointerUp={(event) => {
      const current = drag.current
      if (current?.pointerId !== event.pointerId) return
      resize(current.size + direction * (position(event) - current.origin))
      finish()
    }}
    onPointerCancel={(event) => { if (drag.current?.pointerId === event.pointerId) finish() }}
    onLostPointerCapture={(event) => { if (drag.current?.pointerId === event.pointerId) finish() }}
    onDoubleClick={() => resize(defaultValue)}
    onKeyDown={(event) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return
      const decrease = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'
      const increase = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
      const next = event.key === 'Home' ? minimum : event.key === 'End' ? maximum : event.key === 'Enter' ? defaultValue
        : event.key === decrease ? value - 16 * direction : event.key === increase ? value + 16 * direction : undefined
      if (next === undefined) return
      event.preventDefault()
      resize(next)
    }} />
}
