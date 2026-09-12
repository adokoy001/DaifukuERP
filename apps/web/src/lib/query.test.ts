import { describe, expect, it } from 'vitest';
import { buildListQuery, pageCount, parseListSearch, parseSort, toListState, toggleSort, updateSearch } from './query.ts';

describe('buildListQuery (AC-3)', () => {
  it('defaults to page 1 with limit 50 and no search/orderBy', () => {
    const p = buildListQuery({});
    expect(p.get('limit')).toBe('50');
    expect(p.get('offset')).toBe('0');
    expect(p.has('search')).toBe(false);
    expect(p.has('orderBy')).toBe(false);
  });

  it('encodes search, sort and page offset', () => {
    const p = buildListQuery({ search: ' 商事 ', sort: 'name:desc', page: 3 });
    expect(p.get('search')).toBe('商事');
    expect(p.get('orderBy')).toBe('name:desc');
    expect(p.get('offset')).toBe('100');
  });

  it('serialises where as JSON', () => {
    const p = buildListQuery({ where: { id: { $in: ['a', 'b'] } } });
    expect(JSON.parse(p.get('where') ?? '')).toEqual({ id: { $in: ['a', 'b'] } });
  });

  it('clamps page below 1', () => {
    expect(buildListQuery({ page: 0 }).get('offset')).toBe('0');
    expect(buildListQuery({ page: -4 }).get('offset')).toBe('0');
  });
});

describe('sort helpers', () => {
  it('parses field:dir and defaults to asc', () => {
    expect(parseSort('code')).toEqual({ field: 'code', dir: 'asc' });
    expect(parseSort('code:desc')).toEqual({ field: 'code', dir: 'desc' });
    expect(parseSort('')).toBeUndefined();
    expect(parseSort(':desc')).toBeUndefined();
  });

  it('cycles none -> asc -> desc -> none for the same field', () => {
    expect(toggleSort(undefined, 'name')).toBe('name:asc');
    expect(toggleSort('name:asc', 'name')).toBe('name:desc');
    expect(toggleSort('name:desc', 'name')).toBeUndefined();
  });

  it('switching field starts at asc', () => {
    expect(toggleSort('name:desc', 'code')).toBe('code:asc');
  });
});

describe('parseListSearch / toListState / updateSearch', () => {
  it('keeps only valid keys', () => {
    expect(parseListSearch({ q: 'x', sort: 'name:asc', page: '2', junk: 1 })).toEqual({ q: 'x', sort: 'name:asc', page: 2 });
    expect(parseListSearch({ q: '', sort: 42, page: 'abc' })).toEqual({});
    expect(parseListSearch({ page: 1 })).toEqual({});
  });

  it('maps URL keys to the list state', () => {
    expect(toListState({ q: 'x', sort: 'a:desc', page: 3 })).toEqual({ search: 'x', sort: 'a:desc', page: 3 });
    expect(toListState({})).toEqual({});
  });

  it('updateSearch removes emptied keys and resets page when q/sort change', () => {
    expect(updateSearch({ q: 'a', page: 4 }, { q: 'b' })).toEqual({ q: 'b' });
    expect(updateSearch({ q: 'a', page: 4 }, { q: '' })).toEqual({});
    expect(updateSearch({ q: 'a', page: 4 }, { page: 5 })).toEqual({ q: 'a', page: 5 });
    expect(updateSearch({ q: 'a', sort: 'x:asc', page: 2 }, { sort: undefined })).toEqual({ q: 'a' });
  });
});

describe('pageCount', () => {
  it('rounds up and never returns 0', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
    expect(pageCount(7, 3)).toBe(3);
  });
});
