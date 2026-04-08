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
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const lc = (query || value).toLowerCase()
  const filtered = options.filter((opt) => opt.toLowerCase().includes(lc))

  // Reset active index when filtered list changes
  useEffect(() => {
    setActiveIndex(-1)
  }, [filtered.length, open])

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[data-combobox-item]')
      items[activeIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  const select = (opt: string) => {
    onChange(opt)
    setQuery('')
    setOpen(false)
    setActiveIndex(-1)
    inputRef.current?.blur()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || filtered.length === 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setOpen(true)
        e.preventDefault()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => (i + 1) % filtered.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1))
        break
      case 'Enter':
        e.preventDefault()
        if (activeIndex >= 0 && activeIndex < filtered.length) {
          select(filtered[activeIndex]!)
        }
        break
      case 'Escape':
        setOpen(false)
        setActiveIndex(-1)
        inputRef.current?.blur()
        break
    }
  }

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
          setActiveIndex(-1)
        }}
        onFocus={() => {
          setQuery('')
          setOpen(true)
        }}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <div ref={listRef} className="absolute z-50 mt-1 max-h-40 w-full overflow-auto rounded-md border border-border-subtle bg-popover py-1 shadow-md">
          {filtered.map((opt, i) => (
            <button
              key={opt}
              type="button"
              data-combobox-item
              className={cn(
                'flex w-full items-center gap-2 px-2 py-1 text-xs font-mono text-foreground hover:bg-accent hover:text-accent-foreground',
                opt === value && 'bg-accent/50',
                i === activeIndex && 'bg-accent text-accent-foreground',
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                select(opt)
              }}
              onMouseEnter={() => setActiveIndex(i)}
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
