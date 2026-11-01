import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cx } from '../lib/cx'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'md' | 'lg'

const base =
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,color,transform,box-shadow] duration-200 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0'

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-bg shadow-[inset_0_1px_0_rgb(255_255_255/0.45),0_10px_30px_-14px_rgb(74_222_128/0.85)] hover:-translate-y-0.5 hover:brightness-110',
  secondary: 'depth relative bg-white/[0.04] text-fg hover:bg-white/[0.08] hover:[--depth-edge:rgb(206_255_240/0.24)]',
  ghost: 'text-muted hover:bg-white/[0.06] hover:text-fg',
}

// Heights match the inputs they sit beside: md = 44px, lg = 52px.
const sizes: Record<Size, string> = {
  md: 'h-11 rounded-control px-5 text-[14px]',
  lg: 'h-13 rounded-control-lg px-6 text-[15px]',
}

type Common = { variant?: Variant; size?: Size; className?: string; children: ReactNode }
type ButtonProps = Common & ({ href: string } & ComponentPropsWithoutRef<'a'>) | (Common & { href?: undefined } & ComponentPropsWithoutRef<'button'>)

export function Button(props: ButtonProps) {
  const { variant = 'primary', size = 'md', className, children, ...rest } = props
  const classes = cx(base, variants[variant], sizes[size], className)
  if ('href' in rest && rest.href !== undefined) {
    return (
      <a className={classes} {...(rest as ComponentPropsWithoutRef<'a'>)}>
        {children}
      </a>
    )
  }
  return (
    <button type="button" className={classes} {...(rest as ComponentPropsWithoutRef<'button'>)}>
      {children}
    </button>
  )
}
