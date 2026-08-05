import { Input as InputPrimitive } from '@base-ui/react/input';
import { cx } from 'class-variance-authority';

import styles from './input.module.css';

export interface InputProps extends Omit<InputPrimitive.Props, 'className'> {
  className?: string;
}

export function Input({ className, type, ...props }: InputProps) {
  const input = (
    <InputPrimitive
      type={type}
      className={cx(styles.input, type === 'search' && styles.searchInput, className)}
      {...props}
    />
  );
  if (type !== 'search') {
    return input;
  }
  /*
   * The mockups' Field/search type (Figma frame 193:433) is the same field
   * with a leading magnifier. An <input> is a replaced element — no
   * ::before to draw into, and a background-image can't read the theme's
   * color tokens — so the icon needs this presentational wrapper. Only
   * type="search" pays for it: every other type stays a bare <input>, and
   * the consumer className stays on the input either way, so styling
   * targets the same element regardless of type. Field wiring is
   * unaffected — the primitive is still the control Field talks to.
   */
  return (
    <span className={styles.searchWrap}>
      <svg className={styles.searchIcon} aria-hidden="true" viewBox="0 0 16 16" fill="none">
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {input}
    </span>
  );
}
