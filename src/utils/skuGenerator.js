export function generateSku(categoryCode, subCategoryCode, productName) {
  const catCode = String(categoryCode || '1000').trim().toUpperCase().replace(/[^\w]/g, '');
  const subCode = String(subCategoryCode || '0000').trim().toUpperCase().replace(/[^\w]/g, '');
  const nameClean = String(productName || '')
    .trim()
    .toUpperCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${catCode}-${subCode}-${nameClean}`;
}

export default {
  generateSku,
};