import { Checkbox } from '@/components/ui/checkbox'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

type Props = {
  privileges: string[]
  checked: Record<string, boolean>
  onChange: (priv: string, value: boolean) => void
}

export function PrivilegeCheckboxList({ privileges, checked, onChange }: Props) {
  const { t } = useI18n()
  const allChecked = privileges.every((p) => checked[p])

  const toggleAll = () => {
    const next = !allChecked
    for (const p of privileges) onChange(p, next)
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={toggleAll}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {allChecked ? t('dbusers.deselectAll') : t('dbusers.selectAll')}
      </button>
      <div className="grid grid-cols-3 gap-x-4 gap-y-2">
        {privileges.map((priv) => (
          <label
            key={priv}
            className={cn(
              'flex items-center gap-2 text-xs cursor-pointer select-none',
              checked[priv] ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <Checkbox
              checked={!!checked[priv]}
              onCheckedChange={(v) => onChange(priv, !!v)}
              className="h-3.5 w-3.5"
            />
            <span className="truncate font-mono">{priv}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
