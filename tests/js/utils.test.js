import { fetchJSON, getJSONOrEmpty, API } from '../../static/js/utils/utils.js';

// Mock fetch globally
global.fetch = jest.fn();

describe('utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchJSON', () => {
    test('returns data on successful response', async () => {
      const mockData = { test: 'data' };
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData)
      });

      const result = await fetchJSON('/api/test');
      expect(result).toEqual(mockData);
    });

    test('throws error on failed response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'Not found' })
      });

      await expect(fetchJSON('/api/test')).rejects.toThrow('HTTP 404: Not Found');
    });
  });

  describe('getJSONOrEmpty', () => {
    test('returns data on success', async () => {
      const mockData = { test: 'data' };
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData)
      });

      const result = await getJSONOrEmpty('/api/test');
      expect(result).toEqual(mockData);
    });

    test('returns empty object on error', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await getJSONOrEmpty('/api/test');
      expect(result).toEqual({});
    });

    test('returns empty object on non-ok response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Failed' })
      });

      const result = await getJSONOrEmpty('/api/test');
      expect(result).toEqual({});
    });
  });

  describe('API', () => {
    test('loadStory calls getJSONOrEmpty with correct URL', async () => {
      const mockData = { story: 'data' };
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData)
      });

      const result = await API.loadStory();
      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith('/api/story');
    });

    test('loadProjects calls getJSONOrEmpty with correct URL', async () => {
      const mockData = { projects: [] };
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData)
      });

      const result = await API.loadProjects();
      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith('/api/projects');
    });
  });
});