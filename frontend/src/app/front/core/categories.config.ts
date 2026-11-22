/**
 * Single source of truth for marketplace categories.
 * Used by: home page, sidebar nav, product filters, profile preferences.
 *
 * Image files must be placed in:  frontend/src/assets/categories/
 * Expected filenames:
 *   electronics.png | books.png | gaming.png |
 *   furniture.png   | services.png | sports.png
 */
export interface AppCategory {
  name:  string;
  slug:  string;
  image: string;   // path relative to src/assets/
  icon:  string;   // emoji fallback when image is missing
  color: string;   // gradient fallback background
}

export const APP_CATEGORIES: AppCategory[] = [
  {
    name:  'Electronics',
    slug:  'electronics',
    image: 'assets/categories/electronics.png',
    icon:  '💻',
    color: 'linear-gradient(135deg,#1a1a2e,#16213e)'
  },
  {
    name:  'Books',
    slug:  'books',
    image: 'assets/categories/books.png',
    icon:  '📚',
    color: 'linear-gradient(135deg,#2d6a4f,#1b4332)'
  },
  {
    name:  'Gaming',
    slug:  'gaming',
    image: 'assets/categories/gaming.png',
    icon:  '🎮',
    color: 'linear-gradient(135deg,#6a0572,#3d0140)'
  },
  {
    name:  'Furniture',
    slug:  'furniture',
    image: 'assets/categories/furniture.png',
    icon:  '🪑',
    color: 'linear-gradient(135deg,#7b4f12,#4a2c0a)'
  },
  {
    name:  'Services',
    slug:  'services',
    image: 'assets/categories/services.png',
    icon:  '🛠️',
    color: 'linear-gradient(135deg,#800000,#4a0000)'
  },
  {
    name:  'Sports',
    slug:  'sports',
    image: 'assets/categories/sports.png',
    icon:  '⚽',
    color: 'linear-gradient(135deg,#0077b6,#023e8a)'
  },
];

/** Just the names — used by profile preferences, product filters, etc. */
export const CATEGORY_NAMES: string[] = APP_CATEGORIES.map(c => c.name);
