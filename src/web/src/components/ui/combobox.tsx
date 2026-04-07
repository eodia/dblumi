import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'

type ComboboxProps = {
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  className?: string
  error?: boolean
}

export function Combobox({ value, onChange, options, placeholder, className, error }: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const lc = (query || value).toLowerCase()
  const filtered = options.filter((opt) => opt.toLowerCase().includes(lc))

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query !== '' ? query : value}
        placeholder={placeholder}
        className={cn(
          'flex h-8 w-full rounded-md border bg-background px-2 py-1 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50',
          error ? 'border-destructive text-destructive focus-visible:ring-destructive' : 'border-input focus-visible:ring-ring',
          className,
        )}
        onChange={(e) => {
          setQuery(e.target.value)
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setQuery('')
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false)
            inputRef.current?.blur()
          }
        }}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-40 w-full overflow-auto rounded-md border border-border-subtle bg-popover py-1 shadow-md">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              className={cn(
                'flex w-full items-center gap-2 px-2 py-1 text-xs font-mono text-foreground hover:bg-accent hover:text-accent-foreground',
                opt === value && 'bg-accent/50',
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(opt)
                setQuery('')
                setOpen(false)
                inputRef.current?.blur()
              }}
            >
              <Check className={cn('h-3 w-3 flex-shrink-0', opt === value ? 'opacity-100' : 'opacity-0')} />
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
