import { cn } from '../../lib/utils'
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react'

interface FieldProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
}

export function Field({ label, hint, error, required, children }: FieldProps) {
  return (
    <div className="mb-4">
      <label className={cn(
        'block text-[11px] font-semibold tracking-[0.06em] uppercase text-gray-600 mb-1.5',
        required && "after:content-['*'] after:text-red-500 after:ml-0.5"
      )}>
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-[11px] text-red-600 font-medium">{error}</p>}
      {hint && !error && <p className="mt-1 text-[11px] text-gray-400">{hint}</p>}
    </div>
  )
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

export function Input({ error, className, ...props }: InputProps) {
  return (
    <input
      {...props}
      className={cn(
        'input-field',
        error && 'border-red-500 bg-red-50',
        className
      )}
    />
  )
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean
  options?: { value: string; label: string }[]
  placeholder?: string
}

export function Select({ error, options, placeholder, className, children, ...props }: SelectProps) {
  return (
    <select
      {...props}
      className={cn(
        'input-field appearance-none',
        error && 'border-red-500',
        className
      )}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options
        ? options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)
        : children}
    </select>
  )
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
}

export function Textarea({ error, className, ...props }: TextareaProps) {
  return (
    <textarea
      {...props}
      className={cn(
        'input-field resize-y min-h-[72px]',
        error && 'border-red-500 bg-red-50',
        className
      )}
    />
  )
}

interface CheckboxProps {
  label: ReactNode
  checked?: boolean
  onChange?: (checked: boolean) => void
  className?: string
}

export function Checkbox({ label, checked, onChange, className }: CheckboxProps) {
  return (
    <label className={cn('flex items-start gap-2 cursor-pointer', className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange?.(e.target.checked)}
        className="mt-0.5 w-4 h-4 rounded-sm accent-blue-600 flex-shrink-0"
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}

export function Grid2({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-4', className)}>{children}</div>
  )
}
