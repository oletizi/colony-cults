import { describe, it, expect } from 'vitest';
import { splitIssueOcr } from '@/browser/load/ocr-pages';

/**
 * `issue.txt` is a single form-feed (`\f`)-delimited blob covering every page
 * of an issue. `splitIssueOcr` is the pure function that turns it into one
 * `PageOcr` per page, preserving order, and surfacing a degraded-OCR
 * condition note when the page's own text names one (see
 * specs/005-corpus-browser/data-model.md IssueView/PageView).
 */
describe('splitIssueOcr', () => {
  it('splits a form-feed-delimited issue into one segment per page, in order', () => {
    const issueText = 'Page un texte.\fPage deux texte.\fPage trois texte.';

    const pages = splitIssueOcr(issueText);

    expect(pages).toHaveLength(3);
    expect(pages[0].ocrFrench).toBe('Page un texte.');
    expect(pages[1].ocrFrench).toBe('Page deux texte.');
    expect(pages[2].ocrFrench).toBe('Page trois texte.');
  });

  it('trims a trailing empty segment when the text ends with a form-feed', () => {
    const issueText = 'Page un texte.\fPage deux texte.\f';

    const pages = splitIssueOcr(issueText);

    expect(pages).toHaveLength(2);
    expect(pages[0].ocrFrench).toBe('Page un texte.');
    expect(pages[1].ocrFrench).toBe('Page deux texte.');
  });

  it('flags a segment naming "Contraste insuffisant" with a non-null ocrCondition', () => {
    const issueText = 'Texte normal.\fContraste insuffisant pour cette page.';

    const pages = splitIssueOcr(issueText);

    expect(pages[0].ocrCondition).toBeNull();
    expect(pages[1].ocrCondition).not.toBeNull();
    expect(pages[1].ocrCondition).toMatch(/contraste insuffisant/i);
  });

  it('flags a segment naming "illisible" with a non-null ocrCondition', () => {
    const issueText = 'Texte normal.\fPassage illisible ici.';

    const pages = splitIssueOcr(issueText);

    expect(pages[0].ocrCondition).toBeNull();
    expect(pages[1].ocrCondition).not.toBeNull();
    expect(pages[1].ocrCondition).toMatch(/illisible/i);
  });

  it('is case-insensitive when detecting a degraded-OCR note', () => {
    const issueText = 'CONTRASTE INSUFFISANT en majuscules.';

    const pages = splitIssueOcr(issueText);

    expect(pages[0].ocrCondition).not.toBeNull();
  });

  it('leaves ocrFrench untouched (not stripped of the condition note text)', () => {
    const issueText = 'Contraste insuffisant. Reste du texte OCR bruyant.';

    const pages = splitIssueOcr(issueText);

    expect(pages[0].ocrFrench).toBe('Contraste insuffisant. Reste du texte OCR bruyant.');
  });

  it('throws on empty input', () => {
    expect(() => splitIssueOcr('')).toThrow();
  });

  it('throws on whitespace-only input', () => {
    expect(() => splitIssueOcr('   \n\t  ')).toThrow();
  });
});
