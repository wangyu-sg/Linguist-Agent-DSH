import * as React from 'react'
import { useT } from './ui-locale'
import styles from './ProjectLocaleSelect.module.css'

export const PROJECT_LOCALE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'zh-CN', label: '简体中文（zh-CN）' },
  { value: 'en-US', label: '英语（美国，en-US）' },
  { value: 'zh-TW', label: '繁体中文（台湾，zh-TW）' },
  { value: 'zh-HK', label: '繁体中文（香港，zh-HK）' },
  { value: 'en-GB', label: '英语（英国，en-GB）' },
  { value: 'en-AU', label: '英语（澳大利亚，en-AU）' },
  { value: 'en-CA', label: '英语（加拿大，en-CA）' },
  { value: 'ja-JP', label: '日语（ja-JP）' },
  { value: 'ko-KR', label: '韩语（ko-KR）' },
  { value: 'fr-FR', label: '法语（法国，fr-FR）' },
  { value: 'fr-CA', label: '法语（加拿大，fr-CA）' },
  { value: 'de-DE', label: '德语（de-DE）' },
  { value: 'es-ES', label: '西班牙语（西班牙，es-ES）' },
  { value: 'es-MX', label: '西班牙语（墨西哥，es-MX）' },
  { value: 'pt-BR', label: '葡萄牙语（巴西，pt-BR）' },
  { value: 'pt-PT', label: '葡萄牙语（葡萄牙，pt-PT）' },
  { value: 'it-IT', label: '意大利语（it-IT）' },
  { value: 'nl-NL', label: '荷兰语（nl-NL）' },
  { value: 'ru-RU', label: '俄语（ru-RU）' },
  { value: 'uk-UA', label: '乌克兰语（uk-UA）' },
  { value: 'pl-PL', label: '波兰语（pl-PL）' },
  { value: 'cs-CZ', label: '捷克语（cs-CZ）' },
  { value: 'tr-TR', label: '土耳其语（tr-TR）' },
  { value: 'ar-SA', label: '阿拉伯语（ar-SA）' },
  { value: 'he-IL', label: '希伯来语（he-IL）' },
  { value: 'hi-IN', label: '印地语（hi-IN）' },
  { value: 'th-TH', label: '泰语（th-TH）' },
  { value: 'vi-VN', label: '越南语（vi-VN）' },
  { value: 'id-ID', label: '印度尼西亚语（id-ID）' },
  { value: 'ms-MY', label: '马来语（ms-MY）' },
]

export function ProjectLocaleSelect({ label, value, onValueChange, disabled = false }: {
  label: string
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}): React.ReactElement {
  const t = useT()
  const id = React.useId()
  const known = PROJECT_LOCALE_OPTIONS.some((option) => option.value === value)
  const options = known || value.length === 0
    ? PROJECT_LOCALE_OPTIONS
    : [...PROJECT_LOCALE_OPTIONS, { value, label: `${value}（当前值）` }]
  return <div className={styles.field}>
    <label className={styles.label} htmlFor={id}>{label}</label>
    <select id={id} disabled={disabled} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
    </select>
  </div>
}
