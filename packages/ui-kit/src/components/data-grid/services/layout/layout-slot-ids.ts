/*
 * Ids of the built-in main views, owned by the core rather than by the plugin that registers
 * them (the table view is registered by the core itself; the cards view by the cards plugin). The core reads them (the view selector's labels, `DATA_GRID_VIEW`), and the core's entry
 * must not import a plugin module to do it: that would pull the plugin's code and CSS into every
 * grid that never uses it.
 */
export const TABLE_LAYOUT_SLOT_ID = 'table_layout';
export const CARDS_LAYOUT_SLOT_ID = 'cards_layout';
