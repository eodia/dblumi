import * as React from "react"
import { useState, useRef, useEffect } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

type ComboboxChipsOption = {
  id: string
  label: string
  color?: string | undefined
  /** Minimum query length before this option is shown in the dropdown */
  minQuery?: number | undefined
}

type ComboboxChipsProps = {
  options: ComboboxChipsOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  placeholder?: string
  disabled?: boolean
}

function ComboboxChips({
  options,
  selected,
  onChange,
  placeholder = "Search...",
  disabled = false,
}: ComboboxChipsProps) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const selectedSet = new Set(selected)

  const lc = query.toLowerCase()
  const filteredOptions = options.filter(
    (opt) =>
      !selectedSet.has(opt.id) &&
      (opt.minQuery ? lc.length >= opt.minQuery : true) &&
      opt.label.toLowerCase().includes(lc)
  )

  const selectedOptions = options.filter((opt) => selectedSet.has(opt.id))

  function handleSelect(id: string) {
    onChange([...selected, id])
    setQuery("")
    inputRef.current?.focus()
  }

  function handleRemove(id: string) {
    onChange(selected.filter((s) => s !== id))
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm",
          disabled && "cursor-not-allowed opacity-50"
        )}
        onClick={() => {
          if (!disabled) {
            inputRef.current?.focus()
            setOpen(true)
          }
        }}
      >
        {selectedOptions.map((opt) => (
          <span
            key={opt.id}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              !opt.color && "bg-primary/20 border border-primary/50 text-primary"
            )}
            style={opt.color ? {
              backgroundColor: `${opt.color}33`,
              border: `1px solid ${opt.color}55`,
              color: opt.color,
            } : undefined}
          >
            {opt.color && (
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: opt.color }}
              />
            )}
            {opt.label}
            {!disabled && (
              <button
                type="button"
                className="ml-0.5 rounded-full p-0.5 hover:bg-black/20"
                onClick={(e) => {
                  e.stopPropagation()
                  handleRemove(opt.id)
                }}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="min-w-[80px] flex-1 border-none bg-transparent text-sm text-foreground placeholder:text-text-muted outline-none"
          placeholder={selectedOptions.length === 0 ? placeholder : ""}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
        />
      </div>

      {open && filteredOptions.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border-subtle bg-popover py-1 shadow-md">
          {filteredOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-surface-overlay"
              onClick={() => handleSelect(opt.id)}
            >
              {opt.color && (
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: opt.color }}
                />
              )}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export { ComboboxChips }
export type { ComboboxChipsProps, ComboboxChipsOption }
