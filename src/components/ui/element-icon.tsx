'use client';

import {
  AlignLeft,
  Component,
  FileText,
  Frame,
  Heading,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  Menu,
  Minus,
  MoveVertical,
  Pilcrow,
  RectangleEllipsis,
  Rows3,
  Sparkles,
  Square,
  SquareMousePointer,
  StretchHorizontal,
  TextCursorInput,
  Type,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { ElementType } from '@/lib/document/types';
import { getElement } from '@/lib/document/schema';

const ICONS: Record<string, LucideIcon> = {
  page: FileText,
  section: Rows3,
  container: Square,
  frame: Frame,
  stack: StretchHorizontal,
  grid: LayoutGrid,
  heading: Heading,
  paragraph: Pilcrow,
  text: Type,
  richtext: AlignLeft,
  image: ImageIcon,
  video: Video,
  icon: Sparkles,
  button: SquareMousePointer,
  link: Link2,
  navigation: Menu,
  divider: Minus,
  spacer: MoveVertical,
  form: TextCursorInput,
  input: RectangleEllipsis,
  textarea: AlignLeft,
  component: Component,
};

function iconFor(type: ElementType): LucideIcon {
  return ICONS[getElement(type).icon] ?? Square;
}

export function ElementIcon({
  type,
  size = 13,
  className,
  strokeWidth = 1.6,
}: {
  type: ElementType;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = iconFor(type);
  return <Icon size={size} strokeWidth={strokeWidth} className={className} />;
}
