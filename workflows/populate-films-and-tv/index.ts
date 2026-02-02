import 'dotenv/config';
import { createNotionClient, getAllPages, extractTitle } from "utils/notion";
import { logger } from "utils/logger";
import type { UpdatePageParameters } from "@notionhq/client/build/src/api-endpoints";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.FILMS_DATABASE_ID;
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const OMDB_API_KEY = process.env.OMDB_API_KEY;

if (!NOTION_TOKEN) {
  logger.error("NOTION_TOKEN is not defined");
  process.exit(1);
}

if (!DATABASE_ID) {
  logger.error("FILMS_DATABASE_ID is not defined");
  process.exit(1);
}

if (!TMDB_API_KEY) {
  logger.warn("TMDB_API_KEY is not defined - metadata will not be fetched");
}

if (!OMDB_API_KEY) {
  logger.warn("OMDB_API_KEY is not defined - IMDB and Rotten Tomatoes scores will not be fetched");
}

const notion = createNotionClient(NOTION_TOKEN);

// Type definitions for OMDB API
interface OMDBRating {
  Source: string;
  Value: string;
}

interface OMDBResponse {
  Response: string;
  imdbRating?: string;
  Metascore?: string;
  Ratings?: OMDBRating[];
}

// Type definitions for TMDB API
interface TMDBGenre {
  id: number;
  name: string;
}

interface TMDBCrewMember {
  id: number;
  name: string;
  job: string;
}

interface TMDBCreator {
  id: number;
  name: string;
}

interface TMDBProductionCountry {
  iso_3166_1: string;
  name: string;
}

interface TMDBCredits {
  crew?: TMDBCrewMember[];
}

interface TMDBExternalIds {
  imdb_id?: string;
}

interface TMDBMovieDetails {
  id: number;
  title?: string;
  overview?: string;
  poster_path?: string;
  release_date?: string;
  runtime?: number;
  genres?: TMDBGenre[];
  production_countries?: TMDBProductionCountry[];
  imdb_id?: string;
  external_ids?: TMDBExternalIds;
  credits?: TMDBCredits;
}

interface TMDBTVDetails {
  id: number;
  name?: string;
  overview?: string;
  poster_path?: string;
  first_air_date?: string;
  genres?: TMDBGenre[];
  production_countries?: TMDBProductionCountry[];
  external_ids?: TMDBExternalIds;
  credits?: TMDBCredits;
  created_by?: TMDBCreator[];
}

interface TMDBSearchResult {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string;
  release_date?: string;
  first_air_date?: string;
}

interface TMDBSearchResponse {
  results?: TMDBSearchResult[];
}

interface TMDBFindResponse {
  movie_results?: TMDBSearchResult[];
  tv_results?: TMDBSearchResult[];
}

interface SearchResultWithMetadata extends TMDBSearchResult {
  mediaType: 'movie' | 'tv';
  genres?: string[];
  genreMatchScore?: number;
  yearMatchScore?: number;
  totalScore?: number;
  resultYear?: number | null;
}

// Type definitions for our return types
interface TMDBResult {
  posterUrl: string | null;
  overview: string | null;
  runtime: number | null;
  genres: string[];
  directors: string[];
  writers: string[];
  countries: string[];
  imdbId: string | null;
  type: 'Film' | 'TV Series' | null;
  year: number | null;
}

interface OMDBResult {
  imdbRating: number | null;
  tomatometer: number | null;
  metascore: number | null;
}

const extractYearFromTitle = (title: string): number | undefined => {
  const regex = /\((\d{4})\)/;
  const match = regex.exec(title);
  return match ? Number.parseInt(match[1]) : undefined;
};

const fetchOMDBData = async (imdbId: string): Promise<OMDBResult> => {
  if (!OMDB_API_KEY || !imdbId) return {
    imdbRating: null,
    tomatometer: null,
    metascore: null
  };
  
  try {
    const response = await fetch(
      `http://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${imdbId}`
    );
    const data = await response.json() as OMDBResponse;
    
    if (data.Response === 'False') {
      return {
        imdbRating: null,
        tomatometer: null,
        metascore: null
      };
    }
    
    // Extract IMDB rating
    const imdbRating = data.imdbRating && data.imdbRating !== 'N/A' 
      ? parseFloat(data.imdbRating) 
      : null;
    
    // Extract Rotten Tomatoes scores
    let tomatometer: number | null = null;
    
    if (data.Ratings) {
      const rtRating = data.Ratings.find((r) => r.Source === 'Rotten Tomatoes');
      if (rtRating?.Value) {
        const match = rtRating.Value.match(/(\d+)%/);
        if (match) {
          tomatometer = Number.parseInt(match[1]);
        }
      }
    }
    
    // Extract Metacritic score
    const metascore = data.Metascore && data.Metascore !== 'N/A'
      ? Number.parseInt(data.Metascore)
      : null;
    
    return {
      imdbRating,
      tomatometer,
      metascore
    };
  } catch (err) {
    logger.warn(`Failed to fetch OMDb data for IMDB ID ${imdbId}`, { error: err instanceof Error ? err : undefined });
    return {
      imdbRating: null,
      tomatometer: null,
      metascore: null
    };
  }
};

const fetchTMDBData = async (
  title: string, 
  year?: number, 
  existingImdbId?: string, 
  existingType?: string,
  existingGenres?: string[]
): Promise<TMDBResult> => {
  if (!TMDB_API_KEY) return { 
    posterUrl: null, 
    overview: null, 
    runtime: null,
    genres: [],
    directors: [],
    writers: [],
    countries: [],
    imdbId: null,
    type: null,
    year: null
  };
  
  try {
    // If we have an existing IMDB ID, use it to find the exact match
    if (existingImdbId) {
      logger.info(`Using existing IMDB ID: ${existingImdbId}`);
      
      // First try to find by IMDB ID
      const findResponse = await fetch(
        `https://api.themoviedb.org/3/find/${existingImdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`
      );
      const findData = await findResponse.json() as TMDBFindResponse;
      
      let result: TMDBSearchResult | undefined;
      let mediaType: 'movie' | 'tv' | undefined;
      
      // Check movie results first
      if (findData.movie_results?.length && findData.movie_results.length > 0) {
        result = findData.movie_results[0];
        mediaType = 'movie';
      } else if (findData.tv_results?.length && findData.tv_results.length > 0) {
        result = findData.tv_results[0];
        mediaType = 'tv';
      }
      
      if (result && mediaType) {
        // Fetch full details including credits
        const detailsResponse = await fetch(
          `https://api.themoviedb.org/3/${mediaType}/${result.id}?api_key=${TMDB_API_KEY}&append_to_response=credits`
        );
        const details = await detailsResponse.json() as TMDBMovieDetails | TMDBTVDetails;
        
        // Extract runtime (only for movies, not TV shows)
        let runtime: number | null = null;
        if (mediaType === 'movie' && 'runtime' in details) {
          runtime = details.runtime || null;
        }
        
        // Extract year
        let releaseYear: number | null = null;
        if (mediaType === 'movie' && 'release_date' in details && details.release_date) {
          releaseYear = Number.parseInt(details.release_date.split('-')[0]);
        } else if (mediaType === 'tv' && 'first_air_date' in details && details.first_air_date) {
          releaseYear = Number.parseInt(details.first_air_date.split('-')[0]);
        }
        
        // Extract genres
        const genres = details.genres?.map((genre) => genre.name) || [];
        
        // Extract directors
        const directors: string[] = [];
        if (mediaType === 'movie' && 'credits' in details) {
          const crew = details.credits?.crew || [];
          directors.push(...crew
            .filter((c) => c.job === 'Director')
            .map((c) => c.name));
        } else if (mediaType === 'tv' && 'created_by' in details) {
          directors.push(...(details.created_by || []).map((c) => c.name));
        }
        
        // Extract writers
        const writers: string[] = [];
        if (mediaType === 'movie' && 'credits' in details) {
          const crew = details.credits?.crew || [];
          writers.push(...crew
            .filter((c) => c.job === 'Writer' || c.job === 'Screenplay' || c.job === 'Story')
            .map((c) => c.name));
        } else if (mediaType === 'tv' && 'created_by' in details) {
          writers.push(...(details.created_by || []).map((c) => c.name));
        }
        
        // Extract production countries
        const countries = details.production_countries?.map((country) => country.name) || [];
        
        return {
          posterUrl: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
          overview: result.overview || details.overview || null,
          runtime: runtime,
          genres: genres,
          directors: directors,
          writers: writers,
          countries: countries,
          imdbId: existingImdbId,
          type: mediaType === 'movie' ? 'Film' : 'TV Series',
          year: releaseYear
        };
      }
    }
    
    // Fallback to search if no IMDB ID or IMDB ID lookup failed
    // Remove year from title if present for cleaner search
    const cleanTitle = title.replace(/\s*\(\d{4}\)/, '').trim();
    const searchQuery = encodeURIComponent(cleanTitle);
    const yearParam = year ? `&year=${year}` : '';
    
    // Determine which type to search based on existing type
    let searchMovies = true;
    let searchTV = true;
    
    if (existingType === 'Film') {
      searchTV = false;
    } else if (existingType === 'TV Series') {
      searchMovies = false;
    }
    
    let result: SearchResultWithMetadata | undefined;
    let mediaType: 'movie' | 'tv' | undefined = undefined;
    let allResults: SearchResultWithMetadata[] = [];
    
    // Try movie search if allowed
    if (searchMovies) {
      const response = await fetch(
        `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${searchQuery}${yearParam}`
      );
      const data = await response.json() as TMDBSearchResponse;
      if (data.results && data.results.length > 0) {
        allResults = data.results.map((r) => ({ ...r, mediaType: 'movie' as const }));
      }
    }
    
    // If no movie found and TV search is allowed, try TV search
    if (allResults.length === 0 && searchTV) {
      const response = await fetch(
        `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${searchQuery}${yearParam}`
      );
      const data = await response.json() as TMDBSearchResponse;
      if (data.results && data.results.length > 0) {
        allResults = data.results.map((r) => ({ ...r, mediaType: 'tv' as const }));
      }
    }
    
    // If we have existing genres, try to find a better match
    if (allResults.length > 0) {
      // If we have existing genres to help disambiguate
      if (existingGenres && existingGenres.length > 0) {
        logger.info(`Using existing genres to disambiguate: ${existingGenres.join(', ')}`);
        
        // Fetch full details for each result to compare genres
        const resultsWithGenres = await Promise.all(
          allResults.slice(0, 5).map(async (r): Promise<SearchResultWithMetadata> => {
            try {
              const detailsResponse = await fetch(
                `https://api.themoviedb.org/3/${r.mediaType}/${r.id}?api_key=${TMDB_API_KEY}`
              );
              const details = await detailsResponse.json() as TMDBMovieDetails | TMDBTVDetails;
              const genres = details.genres?.map((genre) => genre.name) || [];
              
              // Get result year
              const resultYear = r.mediaType === 'movie' && 'release_date' in details && details.release_date
                ? parseInt(details.release_date.split('-')[0])
                : r.mediaType === 'tv' && 'first_air_date' in details && details.first_air_date
                ? parseInt(details.first_air_date.split('-')[0])
                : null;
              
              // Calculate genre match score
              const matchingGenres = existingGenres.filter(eg => 
                genres.some(genre => genre.toLowerCase() === eg.toLowerCase())
              );
              const genreMatchScore = matchingGenres.length;
              
              // Calculate year match score (exact match = 100, within 1 year = 50, within 2 = 25, else 0)
              let yearMatchScore = 0;
              if (year && resultYear) {
                const yearDiff = Math.abs(year - resultYear);
                if (yearDiff === 0) yearMatchScore = 100;
                else if (yearDiff === 1) yearMatchScore = 50;
                else if (yearDiff === 2) yearMatchScore = 25;
              }
              
              // Combined score: prioritize exact year match, then genres
              const totalScore = yearMatchScore + (genreMatchScore * 10);
              
              return {
                ...r,
                genres,
                genreMatchScore,
                yearMatchScore,
                totalScore,
                resultYear
              };
            } catch {
              return { ...r, genres: [], genreMatchScore: 0, yearMatchScore: 0, totalScore: 0, resultYear: null };
            }
          })
        );
        
        // Sort by total score (year + genre match)
        resultsWithGenres.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
        
        // Only use genre-based selection if we actually have a match
        if (resultsWithGenres[0] && (resultsWithGenres[0].totalScore || 0) > 0) {
          logger.info(`Found better match - Year: ${resultsWithGenres[0].resultYear} (score: ${resultsWithGenres[0].yearMatchScore}), Genres: ${resultsWithGenres[0].genreMatchScore} matches`);
          result = resultsWithGenres[0];
          mediaType = result.mediaType;
        } else {
          // No genre match, use first result
          result = allResults[0];
          mediaType = result?.mediaType;
        }
      } else if (year) {
        // No existing genres, but we have a year - use it to find best match
        logger.info(`Using year ${year} to find best match`);
        
        const resultsWithYear = await Promise.all(
          allResults.slice(0, 5).map(async (r): Promise<SearchResultWithMetadata> => {
            try {
              const detailsResponse = await fetch(
                `https://api.themoviedb.org/3/${r.mediaType}/${r.id}?api_key=${TMDB_API_KEY}`
              );
              const details = await detailsResponse.json() as TMDBMovieDetails | TMDBTVDetails;
              
              // Get result year
              const resultYear = r.mediaType === 'movie' && 'release_date' in details && details.release_date
                ? parseInt(details.release_date.split('-')[0])
                : r.mediaType === 'tv' && 'first_air_date' in details && details.first_air_date
                ? parseInt(details.first_air_date.split('-')[0])
                : null;
              
              // Calculate year match score
              let yearMatchScore = 0;
              if (resultYear) {
                const yearDiff = Math.abs(year - resultYear);
                if (yearDiff === 0) yearMatchScore = 100;
                else if (yearDiff === 1) yearMatchScore = 50;
                else if (yearDiff === 2) yearMatchScore = 25;
              }
              
              return {
                ...r,
                yearMatchScore,
                resultYear
              };
            } catch {
              return { ...r, yearMatchScore: 0, resultYear: null };
            }
          })
        );
        
        // Sort by year match
        resultsWithYear.sort((a, b) => (b.yearMatchScore || 0) - (a.yearMatchScore || 0));
        
        if (resultsWithYear[0] && (resultsWithYear[0].yearMatchScore || 0) > 0) {
          logger.info(`Found match with year ${resultsWithYear[0].resultYear}`);
          result = resultsWithYear[0];
          mediaType = result?.mediaType;
        } else {
          // No good year match, use first result
          result = allResults[0];
          mediaType = result?.mediaType;
        }
      } else {
        // No existing genres or year, use first result
        result = allResults[0];
        mediaType = result?.mediaType;
      }
    }
    
    if (result && mediaType) {
      // Fetch full details including credits
      const detailsResponse = await fetch(
        `https://api.themoviedb.org/3/${mediaType}/${result.id}?api_key=${TMDB_API_KEY}&append_to_response=credits`
      );
      const details = await detailsResponse.json() as TMDBMovieDetails | TMDBTVDetails;
      
      // Extract runtime (only for movies, not TV shows)
      let runtime: number | null = null;
      if (mediaType === 'movie' && 'runtime' in details) {
        runtime = details.runtime || null;
      }
      
      // Extract year
      let releaseYear: number | null = null;
      if (mediaType === 'movie' && 'release_date' in details && details.release_date) {
        releaseYear = parseInt(details.release_date.split('-')[0]);
      } else if (mediaType === 'tv' && 'first_air_date' in details && details.first_air_date) {
        releaseYear = parseInt(details.first_air_date.split('-')[0]);
      }
      
      // Extract genres
      const genres = details.genres?.map((genre) => genre.name) || [];
      
      // Extract directors
      const directors: string[] = [];
      if (mediaType === 'movie' && 'credits' in details) {
        const crew = details.credits?.crew || [];
        directors.push(...crew
          .filter((c) => c.job === 'Director')
          .map((c) => c.name));
      } else if (mediaType === 'tv' && 'created_by' in details) {
        directors.push(...(details.created_by || []).map((c) => c.name));
      }
      
      // Extract writers
      const writers: string[] = [];
      if (mediaType === 'movie' && 'credits' in details) {
        const crew = details.credits?.crew || [];
        writers.push(...crew
          .filter((c) => c.job === 'Writer' || c.job === 'Screenplay' || c.job === 'Story')
          .map((c) => c.name));
      } else if (mediaType === 'tv' && 'created_by' in details) {
        writers.push(...(details.created_by || []).map((c) => c.name));
      }
      
      // Extract production countries
      const countries = details.production_countries?.map((country) => country.name) || [];
      
      // Get IMDB ID
      const imdbId = ('imdb_id' in details && details.imdb_id) || details.external_ids?.imdb_id || null;
      
      return {
        posterUrl: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
        overview: result.overview || null,
        runtime: runtime,
        genres: genres,
        directors: directors,
        writers: writers,
        countries: countries,
        imdbId: imdbId,
        type: mediaType === 'movie' ? 'Film' : 'TV Series',
        year: releaseYear
      };
    }
    return { 
      posterUrl: null, 
      overview: null, 
      runtime: null,
      genres: [],
      directors: [],
      writers: [],
      countries: [],
      imdbId: null,
      type: null,
      year: null
    };
  } catch (err) {
    logger.warn(`Failed to fetch TMDB data for "${title}"`);
    return { 
      posterUrl: null, 
      overview: null, 
      runtime: null,
      genres: [],
      directors: [],
      writers: [],
      countries: [],
      imdbId: null,
      type: null,
      year: null
    };
  }
};

const run = async () => {
  logger.info("Fetching all pages from films database...");
  const pages = await getAllPages(DATABASE_ID, NOTION_TOKEN);

  logger.info("Pages retrieved", { count: pages.length });

  // Find pages missing any metadata
  const needsMetadata = pages.filter(page => {
    const title = extractTitle(page);
    const yearInTitle = extractYearFromTitle(title);
    const yearInProperty = page.properties.Year?.number;
    const titleMissingYear = !yearInTitle && yearInProperty;
    
    return (
      !page.cover || 
      !page.properties.Overview?.rich_text?.[0]?.plain_text ||
      !page.properties.Type?.select?.name ||
      page.properties.Year?.number == null ||
      page.properties['Runtime (Raw)']?.number == null ||
      page.properties.Genre?.multi_select?.length === 0 ||
      !page.properties['Director(s)']?.rich_text?.[0]?.plain_text ||
      !page.properties['Writer(s)']?.rich_text?.[0]?.plain_text ||
      !page.properties.Country?.rich_text?.[0]?.plain_text ||
      !page.properties['IMDB ID']?.rich_text?.[0]?.plain_text ||
      page.properties['IMDB Score']?.number == null ||
      page.properties['Tomatometer (Raw)']?.number == null ||
      page.properties['Metascore']?.number == null ||
      titleMissingYear
    );
  });
  
  if (needsMetadata.length === 0) {
    logger.info("All pages already have complete metadata!");
    return;
  }

  logger.info(`Found ${needsMetadata.length} pages needing metadata`);
  
  for (const page of needsMetadata) {
    let title = extractTitle(page);
    let year = extractYearFromTitle(title);
    let titleNeedsUpdate = false;
    
    // If title doesn't have year but we can determine year from existing data, append it
    if (!year && page.properties.Year?.number) {
      const existingYear = page.properties.Year.number;
      title = `${title} (${existingYear})`;
      year = existingYear;
      titleNeedsUpdate = true;
    }
    
    // Get existing Type and IMDB ID if present
    const existingType = page.properties.Type?.select?.name;
    const existingImdbId = page.properties['IMDB ID']?.rich_text?.[0]?.plain_text;
    
    // Get existing genres if present (for better search disambiguation)
    const existingGenres = page.properties.Genre?.multi_select?.map((genre: { name: string }) => genre.name) || [];
    
    logger.info(`Processing: ${title}${existingType ? ` [Type: ${existingType}]` : ''}${existingImdbId ? ` [IMDB: ${existingImdbId}]` : ''}${existingGenres.length > 0 ? ` [Genres: ${existingGenres.join(', ')}]` : ''}`);
    
    const tmdbData = await fetchTMDBData(title, year, existingImdbId, existingType, existingGenres);
    
    if (!tmdbData.type && !existingType) {
      logger.warn(`Could not find TMDB data for ${title}`);
      await new Promise(resolve => setTimeout(resolve, 300));
      continue;
    }
    
    const additionalUpdates: UpdatePageParameters['properties'] = {};
    
    // Set cover if needed
    if (!page.cover && tmdbData.posterUrl) {
      try {
        await notion.pages.update({
          page_id: page.id,
          cover: {
            type: "external",
            external: { url: tmdbData.posterUrl }
          }
        });
        logger.success(`✓ Set cover image for ${title}`);
      } catch (err) {
        logger.warn(`Failed to set cover for ${title}`, { error: err instanceof Error ? err : undefined });
      }
    }
    
    // Type - only set if not already set
    const hasType = page.properties.Type?.select?.name;
    if (!hasType && tmdbData.type) {
      additionalUpdates.Type = { select: { name: tmdbData.type } };
    }
    
    // Overview
    const hasOverview = page.properties.Overview?.rich_text?.[0]?.plain_text;
    if (!hasOverview && tmdbData.overview) {
      additionalUpdates.Overview = {
        rich_text: [{ text: { content: tmdbData.overview } }]
      };
    }
    
    // Year - use TMDB data or extracted year from title
    const hasYear = page.properties.Year?.number != null;
    if (!hasYear) {
      const yearToUse = tmdbData.year || year;
      if (yearToUse) {
        additionalUpdates.Year = { number: yearToUse };
        // If we're setting the year for the first time and title doesn't have it, mark for update
        if (!extractYearFromTitle(extractTitle(page))) {
          title = `${extractTitle(page)} (${yearToUse})`;
          titleNeedsUpdate = true;
        }
      }
    }
    
    // Runtime (only for films, skip for TV Series)
    const currentType = hasType || tmdbData.type;
    const hasRuntime = page.properties['Runtime (Raw)']?.number != null;
    if (!hasRuntime && tmdbData.runtime && currentType === 'Film') {
      additionalUpdates['Runtime (Raw)'] = { number: tmdbData.runtime };
    }
    
    // Genre - merge with existing genres
    const hasGenre = page.properties.Genre?.multi_select?.length ?? 0 > 0;
    if (!hasGenre && tmdbData.genres.length > 0) {
      additionalUpdates.Genre = {
        multi_select: tmdbData.genres.map((genre: string) => ({ name: genre }))
      };
    } else if (hasGenre && tmdbData.genres.length > 0) {
      // Merge: keep existing genres and add new ones that don't exist
      const existingGenreNames = existingGenres.map((genre: string) => genre.toLowerCase());
      const newGenres = tmdbData.genres.filter((genre: string) => 
        !existingGenreNames.includes(genre.toLowerCase())
      );
      if (newGenres.length > 0) {
        additionalUpdates.Genre = {
          multi_select: [...existingGenres.map((genre: string) => ({ name: genre })), ...newGenres.map((genre: string) => ({ name: genre }))]
        };
      }
    }
    
    // Directors
    const hasDirectors = page.properties['Director(s)']?.rich_text?.[0]?.plain_text;
    if (!hasDirectors && tmdbData.directors.length > 0) {
      additionalUpdates['Director(s)'] = {
        rich_text: [{ text: { content: tmdbData.directors.join(', ') } }]
      };
    }
    
    // Writers
    const hasWriters = page.properties['Writer(s)']?.rich_text?.[0]?.plain_text;
    if (!hasWriters && tmdbData.writers.length > 0) {
      additionalUpdates['Writer(s)'] = {
        rich_text: [{ text: { content: tmdbData.writers.join(', ') } }]
      };
    }
    
    // Country
    const hasCountry = page.properties.Country?.rich_text?.[0]?.plain_text;
    if (!hasCountry && tmdbData.countries.length > 0) {
      additionalUpdates.Country = {
        rich_text: [{ text: { content: tmdbData.countries.join(', ') } }]
      };
    }
    
    // IMDB ID - only set if not already set
    const hasImdbId = page.properties['IMDB ID']?.rich_text?.[0]?.plain_text;
    if (!hasImdbId && tmdbData.imdbId) {
      additionalUpdates['IMDB ID'] = {
        rich_text: [{ text: { content: tmdbData.imdbId } }]
      };
    }
    
    // Fetch OMDb data if we have an IMDB ID (existing or from TMDB)
    const imdbIdToUse = hasImdbId || tmdbData.imdbId;
    if (imdbIdToUse) {
      const omdbData = await fetchOMDBData(imdbIdToUse);
      
      // IMDB Score
      const hasImdbScore = page.properties['IMDB Score']?.number != null;
      if (!hasImdbScore && omdbData.imdbRating) {
        additionalUpdates['IMDB Score'] = { number: omdbData.imdbRating };
      }
      
      // Tomatometer
      const hasTomatometer = page.properties['Tomatometer (Raw)']?.number != null;
      if (!hasTomatometer && omdbData.tomatometer) {
        additionalUpdates['Tomatometer (Raw)'] = { number: omdbData.tomatometer };
      }
      
      // Metascore
      const hasMetascore = page.properties['Metascore']?.number == null;
      if (!hasMetascore && omdbData.metascore) {
        additionalUpdates['Metascore'] = { number: omdbData.metascore };
      }
    }
    
    // Add title update if needed
    if (titleNeedsUpdate) {
      additionalUpdates['Name'] = {
        title: [{ text: { content: title } }]
      };
    }
    
    // Update all properties at once
    if (Object.keys(additionalUpdates).length > 0) {
      try {
        await notion.pages.update({
          page_id: page.id,
          properties: additionalUpdates
        });
        logger.success(`✓ Set fields for ${title}: ${Object.keys(additionalUpdates).join(', ')}`);
      } catch (err) {
        logger.warn(`Failed to set fields for ${title}`, { error: err instanceof Error ? err : undefined });
      }
    }
    
    // Rate limit delay
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  logger.success("✅ All metadata complete!");
};

try {
  await run();
} catch (err) {
  logger.error("Unexpected error", err instanceof Error ? err : undefined);
  process.exit(1);
}