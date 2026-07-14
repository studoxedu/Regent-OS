import { cn } from '../../lib/utils'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'amber'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const variantClass: Record<Variant, string> = {
  primary:   'bg-blue-600 text-white hover:bg-blue-700 border border-transparent shadow-sm',
  secondary: 'bg-white text-navy-800 border border-navy-200 hover:bg-navy-100 shadow-sm',
  ghost:     'bg-transparent text-navy-800 border border-gray-200 hover:bg-gray-50',
  danger:    'bg-red-600 text-white border border-transparent hover:bg-red-700 shadow-sm',
  amber:     'bg-amber-500 text-white border border-transparent hover:bg-amber-800 shadow-sm',
}

const sizeClass: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-2.5 text-md',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 font-semibold rounded-md',
        'transition-colors duration-150 cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none',
        variantClass[variant],
        sizeClass[size],
        className
      )}
    >
      {children}
    </button>
  )
}
