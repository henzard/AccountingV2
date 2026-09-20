/**
 * Categories that should appear first in the equal split, in priority order.
 * Prioritizes big fixed costs (rent, utilities, groceries) over discretionary
 * spending (entertainment, clothing, etc.), so when the user reads the form
 * top-to-bottom, they see the commitments they must honor before fun money.
 *
 * Matching is case-insensitive against the category names from
 * ExpenseCategoriesStep.
 */
const PRIORITY_CATEGORIES = [
  'Rent',
  'Mortgage',
  'Rent / Mortgage',
  'Groceries',
  'Transport',
  'Utilities',
  'Electricity',
];

/**
 * Reorders categories to put high-priority fixed costs first, then the rest
 * in their original order.
 *
 * For example, ['Entertainment', 'Rent', 'Groceries', 'Airtime'] becomes
 * ['Rent', 'Groceries', 'Entertainment', 'Airtime'].
 */
export function sortCategoriesByPriority(categories: string[]): string[] {
  const lowerCasePriority = new Map<string, number>();
  PRIORITY_CATEGORIES.forEach((cat, index) => {
    lowerCasePriority.set(cat.toLowerCase(), index);
  });

  const prioritized: string[] = [];
  const rest: string[] = [];

  for (const cat of categories) {
    const lowerCat = cat.toLowerCase();
    if (lowerCasePriority.has(lowerCat)) {
      prioritized.push(cat);
    } else {
      rest.push(cat);
    }
  }

  // Sort prioritized by the PRIORITY_CATEGORIES order
  prioritized.sort((a, b) => {
    const priorityA = lowerCasePriority.get(a.toLowerCase()) ?? Infinity;
    const priorityB = lowerCasePriority.get(b.toLowerCase()) ?? Infinity;
    return priorityA - priorityB;
  });

  return [...prioritized, ...rest];
}
