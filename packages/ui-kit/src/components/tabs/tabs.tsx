import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cva, cx, type VariantProps } from 'class-variance-authority';

import styles from './tabs.module.css';

/*
 * Base UI names these parts Root/List/Tab/Panel (see @base-ui/react/tabs);
 * the kit exposes the shadcn-registry's public names (Tabs/TabsList/
 * TabsTrigger/TabsContent) so consumers coming from shadcn's docs
 * recognize them. Every prop besides `className` is Base UI's own — see
 * each part's re-exported `Props` type below.
 *
 * base-vega's own translation renders every part as a styled div/button
 * with no Base UI `Indicator` part: the "line" variant's underline is a
 * static `::after` pseudo-element toggled per tab by `data-active`, not
 * one element sliding between tabs. Base UI's `Tabs.Indicator` (a `<span>`
 * whose position/size Base UI measures and writes as CSS variables at
 * runtime — see `TabsIndicatorCssVars`) would be a genuine upgrade for the
 * "line" variant, but it's deliberately left unexposed here: the source
 * this kit translates does not use it, adding it would be writing new UI
 * rather than curating the existing design, and it can be added later as
 * an additive, optional export without breaking this API.
 */

export interface TabsProps extends Omit<TabsPrimitive.Root.Props, 'className'> {
  className?: string;
}

export function Tabs({ className, ...props }: TabsProps) {
  return <TabsPrimitive.Root className={cx(styles.tabs, className)} {...props} />;
}

const tabsListVariants = cva(styles.list, {
  variants: {
    variant: {
      default: styles.variantDefault,
      line: styles.variantLine,
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface TabsListProps
  extends Omit<TabsPrimitive.List.Props, 'className'>,
    VariantProps<typeof tabsListVariants> {
  className?: string;
}

export function TabsList({ className, variant, ...props }: TabsListProps) {
  return <TabsPrimitive.List className={tabsListVariants({ variant, className })} {...props} />;
}

export interface TabsTriggerProps extends Omit<TabsPrimitive.Tab.Props, 'className'> {
  className?: string;
}

export function TabsTrigger({ className, ...props }: TabsTriggerProps) {
  return <TabsPrimitive.Tab className={cx(styles.trigger, className)} {...props} />;
}

export interface TabsContentProps extends Omit<TabsPrimitive.Panel.Props, 'className'> {
  className?: string;
}

export function TabsContent({ className, ...props }: TabsContentProps) {
  return <TabsPrimitive.Panel className={cx(styles.content, className)} {...props} />;
}
