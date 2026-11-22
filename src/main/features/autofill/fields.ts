/**
 * What the in-page script reports about each form control. Plain data, so the
 * matching in match.ts can be tested against fixtures without a browser.
 */
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'date'
  /** Native <select>. */
  | 'select'
  /** react-select style input with role="combobox"; options appear when the menu opens. */
  | 'combobox'
  /** A group of radio buttons sharing a name. */
  | 'radio'
  /** A group of checkboxes sharing a name ("select all that apply"). */
  | 'checkboxes'
  /** A single checkbox ("I agree"). */
  | 'checkbox'
  | 'file'

export interface FieldDescriptor {
  /** Handle the page script uses to find the element again. */
  key: string
  /** Visible label, without the trailing required asterisk. */
  label: string
  name: string
  id: string
  kind: FieldKind
  autocomplete: string
  /** Visible option texts. Empty for free text, and for comboboxes whose options load as you type. */
  options: string[]
  required: boolean
  /** Combobox or select that accepts several values. */
  multi: boolean
  /** Already has a value (filled by the user or a previous run). Never overwritten. */
  hasValue: boolean
  /** Text of the enclosing fieldset legend, e.g. "Phone". */
  group: string
}

export const CHOICE_KINDS: FieldKind[] = ['select', 'combobox', 'radio', 'checkboxes', 'checkbox']
