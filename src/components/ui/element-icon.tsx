'use client';

import {
  AlignLeft,
  ChevronRight,
  ChevronsUpDown,
  CircleDot,
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
  PictureInPicture2,
  Pilcrow,
  RectangleEllipsis,
  Rows3,
  Sparkles,
  Square,
  SquareCheck,
  SquareMousePointer,
  StretchHorizontal,
  Table,
  TableCellsMerge,
  TableProperties,
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
  select: ChevronsUpDown,
  checkbox: SquareCheck,
  radio: CircleDot,
  details: ChevronRight,
  popover: PictureInPicture2,
  table: Table,
  tableRow: TableProperties,
  tableCell: TableCellsMerge,
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
