import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createSlice, configureStore, createAsyncThunk } from '@reduxjs/toolkit';
import { useSelector, useDispatch, Provider } from 'react-redux';

// --- Constants ---
const API_URL = 'https://closet-recruiting-api.azurewebsites.net/api/data';
const ITEMS_PER_LOAD = 12; // Number of items to load per infinite scroll batch

// --- Redux Slices ---

// Async Thunk for fetching content data
export const fetchContent = createAsyncThunk(
  'content/fetchContent',
  async (_, { rejectWithValue }) => {
    try {
      const response = await fetch(API_URL);
      if (!response.ok) {
        throw new Error('Failed to fetch content');
      }
      const data = await response.json();
      return data;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

// Content Slice
const contentSlice = createSlice({
  name: 'content',
  initialState: {
    items: [],
    loading: 'idle', // 'idle' | 'pending' | 'succeeded' | 'failed'
    error: null,
    visibleItemCount: ITEMS_PER_LOAD,
    hasMore: true,
  },
  reducers: {
    loadMoreItems: (state) => {
      // Check if there are more items to load from the *total filtered* items
      // This logic will be applied in the selector or component that filters
      state.visibleItemCount += ITEMS_PER_LOAD;
    },
    resetVisibleItems: (state) => {
      state.visibleItemCount = ITEMS_PER_LOAD;
      state.hasMore = true;
    },
    setHasMore: (state, action) => {
      state.hasMore = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchContent.pending, (state) => {
        state.loading = 'pending';
        state.error = null;
      })
      .addCase(fetchContent.fulfilled, (state, action) => {
        state.loading = 'succeeded';
        state.items = action.payload;
        state.visibleItemCount = ITEMS_PER_LOAD; // Reset visible count on new fetch
        state.hasMore = true; // Assume more on new fetch
      })
      .addCase(fetchContent.rejected, (state, action) => {
        state.loading = 'failed';
        state.error = action.payload;
      });
  },
});

export const { loadMoreItems, resetVisibleItems, setHasMore } = contentSlice.actions;

// Filters Slice
const filtersSlice = createSlice({
  name: 'filters',
  initialState: {
    pricingOptions: {
      paid: false,
      free: false,
      viewOnly: false,
    },
    keyword: '',
    sortBy: 'itemName', // 'itemName', 'higherPrice', 'lowerPrice'
    priceRange: [0, 999], // Min and Max for slider
    isPriceSliderActive: false, // Controls slider activation
  },
  reducers: {
    togglePricingOption: (state, action) => {
      const { option } = action.payload;
      state.pricingOptions[option] = !state.pricingOptions[option];

      // If 'Paid' option is toggled, update slider active state
      if (option === 'paid') {
        state.isPriceSliderActive = state.pricingOptions.paid;
        // Reset price range if paid is deselected
        if (!state.pricingOptions.paid) {
          state.priceRange = [0, 999];
        }
      }
    },
    setKeyword: (state, action) => {
      state.keyword = action.payload;
    },
    setSortBy: (state, action) => {
      state.sortBy = action.payload;
    },
    setPriceRange: (state, action) => {
      state.priceRange = action.payload;
    },
    resetFilters: (state) => {
      state.pricingOptions = {
        paid: false,
        free: false,
        viewOnly: false,
      };
      state.keyword = '';
      state.sortBy = 'itemName';
      state.priceRange = [0, 999];
      state.isPriceSliderActive = false;
    },
  },
});

export const { togglePricingOption, setKeyword, setSortBy, setPriceRange, resetFilters } = filtersSlice.actions;

// --- Redux Store ---
const store = configureStore({
  reducer: {
    content: contentSlice.reducer,
    filters: filtersSlice.reducer,
  },
});

// --- Selectors ---
const selectAllContent = (state) => state.content.items;
const selectFilters = (state) => state.filters;
const selectVisibleItemCount = (state) => state.content.visibleItemCount;
const selectContentLoading = (state) => state.content.loading;
const selectContentError = (state) => state.content.error;
const selectHasMore = (state) => state.content.hasMore;

// Combined selector for filtered and sorted content
const selectFilteredAndSortedContent = (state) => {
  const allItems = selectAllContent(state);
  const { pricingOptions, keyword, sortBy, priceRange, isPriceSliderActive } = selectFilters(state);

  let filteredItems = allItems;

  // 1. Apply Pricing Option Filters
  const anyPricingOptionSelected = pricingOptions.paid || pricingOptions.free || pricingOptions.viewOnly;

  if (anyPricingOptionSelected) {
    filteredItems = filteredItems.filter(item => {
      const isPaid = item.price !== null && item.price !== undefined;
      const isFree = item.price === 0 || item.price === 'FREE' || item.price === 'Free' ; // Assuming "Free" string or 0 price
      const isViewOnly = item.price === 'VIEW_ONLY' || item.price === 'View Only'; // Assuming "View Only" string

      // Convert price to number for comparison if it's a string like "$32.00"
      const numericPrice = isPaid ? parseFloat(String(item.price).replace(/[^0-9.-]+/g,"")) : null;

      let match = false;
      if (pricingOptions.paid && isPaid) match = true;
      if (pricingOptions.free && isFree) match = true;
      if (pricingOptions.viewOnly && isViewOnly) match = true;
      return match;
    });
  }

  // 2. Apply Keyword Search
  if (keyword) {
    const lowerCaseKeyword = keyword.toLowerCase();
    filteredItems = filteredItems.filter(item =>
      (item.title && item.title.toLowerCase().includes(lowerCaseKeyword)) ||
      (item.userName && item.userName.toLowerCase().includes(lowerCaseKeyword))
    );
  }

  // 3. Apply Price Range Filter (only if 'Paid' is selected and slider is active)
  if (isPriceSliderActive && pricingOptions.paid) {
    filteredItems = filteredItems.filter(item => {
      const itemPrice = parseFloat(String(item.price).replace(/[^0-9.-]+/g,""));
      return itemPrice >= priceRange[0] && itemPrice <= priceRange[1];
    });
  }

  // 4. Apply Sorting
  const sortedItems = [...filteredItems].sort((a, b) => {
    switch (sortBy) {
      case 'higherPrice':
        const priceAHigh = parseFloat(String(a.price).replace(/[^0-9.-]+/g,"")) || 0;
        const priceBHigh = parseFloat(String(b.price).replace(/[^0-9.-]+/g,"")) || 0;
        return priceBHigh - priceAHigh;
      case 'lowerPrice':
        const priceALow = parseFloat(String(a.price).replace(/[^0-9.-]+/g,"")) || 0;
        const priceBLow = parseFloat(String(b.price).replace(/[^0-9.-]+/g,"")) || 0;
        return priceALow - priceBLow;
      case 'itemName': // Default
      default:
        const titleA = a.title || '';
        const titleB = b.title || '';
        return titleA.localeCompare(titleB);
    }
  });

  return sortedItems;
};

// --- Components ---

const Header = () => {
  const dispatch = useDispatch();
  const keyword = useSelector(state => state.filters.keyword);

  const handleKeywordChange = (e) => {
    dispatch(setKeyword(e.target.value));
    dispatch(resetVisibleItems()); // Reset pagination on new search
  };

  return (
    <header className="bg-[#1a1a1a] p-4 text-white shadow-md rounded-md flex flex-col md:flex-row items-center justify-between">
      <div className="flex items-center space-x-2 mb-2 md:mb-0">
        <span className="text-xl font-bold text-green-400">CONNECT</span>
        <span className="text-sm italic text-gray-400">Find the items you're looking for</span>
      </div>
      <div className="flex items-center bg-[#2d2d2d] rounded-full px-4 py-2 w-full md:w-auto max-w-md">
        <span className="mr-2 text-gray-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H5a3 3 0 01-3-3v-1a3 3 0 013-3h12a3 3 0 013 3v1a3 3 0 01-3 3H11z"></path>
          </svg>
        </span>
        <input
          type="text"
          placeholder="Keyword search"
          className="bg-transparent outline-none w-full text-white placeholder-gray-500"
          value={keyword}
          onChange={handleKeywordChange}
        />
        <button className="ml-2 text-gray-400 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
        </button>
      </div>
    </header>
  );
};

const FilterSection = () => {
  const dispatch = useDispatch();
  const { pricingOptions, sortBy, priceRange, isPriceSliderActive } = useSelector(selectFilters);

  const filteredItems = useSelector(selectFilteredAndSortedContent); // Get all filtered items to determine hasMore

  const handleCheckboxChange = (option) => {
    dispatch(togglePricingOption({ option }));
    dispatch(resetVisibleItems()); // Reset pagination on filter change
  };

  const handleReset = () => {
    dispatch(resetFilters());
    dispatch(resetVisibleItems()); // Reset pagination on reset
  };

  const handleSortChange = (e) => {
    dispatch(setSortBy(e.target.value));
    dispatch(resetVisibleItems()); // Reset pagination on sort change
  };

  // State for the custom range slider
  const [minPrice, setMinPrice] = useState(priceRange[0]);
  const [maxPrice, setMaxPrice] = useState(priceRange[1]);
  const rangeRef = useRef(null);

  useEffect(() => {
    setMinPrice(priceRange[0]);
    setMaxPrice(priceRange[1]);
  }, [priceRange]);

  const handleMinChange = (e) => {
    let value = parseInt(e.target.value);
    if (value >= maxPrice) {
      value = maxPrice - 1; // Prevent overlap
    }
    setMinPrice(value);
    dispatch(setPriceRange([value, maxPrice]));
    dispatch(resetVisibleItems());
  };

  const handleMaxChange = (e) => {
    let value = parseInt(e.target.value);
    if (value <= minPrice) {
      value = minPrice + 1; // Prevent overlap
    }
    setMaxPrice(value);
    dispatch(setPriceRange([minPrice, value]));
    dispatch(resetVisibleItems());
  };

  // Calculate percentage for slider fill
  const getFillPercentage = () => {
    const range = 999 - 0;
    const minPercent = ((minPrice - 0) / range) * 100;
    const maxPercent = ((maxPrice - 0) / range) * 100;
    return { min: minPercent, max: maxPercent };
  };

  const { min: minFill, max: maxFill } = getFillPercentage();


  return (
    <div className="bg-[#1a1a1a] p-4 my-4 rounded-md shadow-md">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white text-lg font-semibold flex items-center">
          <span className="text-green-400 mr-2">•</span> Contents Filter
        </h2>
        <button
          onClick={handleReset}
          className="bg-gray-700 text-white px-4 py-2 rounded-full text-sm hover:bg-gray-600 transition-colors"
        >
          RESET
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-4">
        {['paid', 'free', 'viewOnly'].map((option) => (
          <label key={option} className="inline-flex items-center text-white cursor-pointer">
            <input
              type="checkbox"
              className="form-checkbox h-5 w-5 text-green-400 rounded-md border-gray-600 bg-gray-700 focus:ring-green-500"
              checked={pricingOptions[option]}
              onChange={() => handleCheckboxChange(option)}
            />
            <span className="ml-2 capitalize">{option === 'viewOnly' ? 'View Only' : option}</span>
          </label>
        ))}
      </div>

      {/* Pricing Slider */}
      <div className="mt-6 mb-8 p-4 bg-[#2d2d2d] rounded-md" style={{ opacity: pricingOptions.paid ? 1 : 0.5, pointerEvents: pricingOptions.paid ? 'auto' : 'none' }}>
        <h3 className="text-white text-md font-semibold mb-4">Pricing Slider</h3>
        <div className="relative h-2 bg-gray-600 rounded-full mb-6">
          <div
            className="absolute h-full bg-green-400 rounded-full"
            style={{ left: `${minFill}%`, right: `${100 - maxFill}%` }}
          ></div>
          <input
            type="range"
            min="0"
            max="999"
            value={minPrice}
            onChange={handleMinChange}
            className="absolute appearance-none bg-transparent w-full h-2 z-20 slider-thumb-green"
            style={{ top: 0, left: 0 }}
          />
          <input
            type="range"
            min="0"
            max="999"
            value={maxPrice}
            onChange={handleMaxChange}
            className="absolute appearance-none bg-transparent w-full h-2 z-20 slider-thumb-green"
            style={{ top: 0, left: 0 }}
          />
        </div>
        <div className="flex justify-between text-white text-sm">
          <span>${minPrice}</span>
          <span>${maxPrice}</span>
        </div>
      </div>

      {/* Sorting Dropdown */}
      <div className="mt-4 flex items-center">
        <label htmlFor="sort-by" className="text-white text-md font-semibold mr-2">Sort by:</label>
        <select
          id="sort-by"
          className="bg-gray-700 text-white px-3 py-2 rounded-md border border-gray-600 focus:outline-none focus:border-green-400"
          value={sortBy}
          onChange={handleSortChange}
        >
          <option value="itemName">Item Name (Default)</option>
          <option value="higherPrice">Higher Price</option>
          <option value="lowerPrice">Lower Price</option>
        </select>
      </div>

    </div>
  );
};


const ContentCard = ({ item }) => {
  const imageUrl = item.image || item.photo || `https://placehold.co/300x400/333333/FFFFFF?text=No+Image`;
  const isPaid = item.price !== null && item.price !== undefined && item.price !== 'FREE' && item.price !== 'Free' && item.price !== 'VIEW_ONLY' && item.price !== 'View Only' && item.price !== 0;
  const priceDisplay = isPaid
    ? `$${parseFloat(String(item.price).replace(/[^0-9.-]+/g,"")).toFixed(2)}`
    : (item.price === 0 || item.price === 'FREE' || item.price === 'Free' ? 'FREE' : 'VIEW ONLY');

  return (
    <div className="bg-[#2d2d2d] rounded-lg overflow-hidden shadow-lg transform transition-transform duration-200 hover:scale-102">
      <img
        src={imageUrl}
        alt={item.title || 'Content Image'}
        className="w-full h-48 object-cover"
        onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/300x400/333333/FFFFFF?text=No+Image`; }}
      />
      <div className="p-4">
        <p className="text-gray-400 text-sm mb-1 truncate">{item.userName || 'Unknown User'}</p>
        <h3 className="text-white font-semibold text-md mb-2 truncate">{item.title || 'Untitled Item'}</h3>
        <p className="text-green-400 text-lg font-bold">{priceDisplay}</p>
      </div>
    </div>
  );
};

const SkeletonCard = () => (
  <div className="bg-[#2d2d2d] rounded-lg overflow-hidden shadow-lg animate-pulse">
    <div className="w-full h-48 bg-gray-700"></div>
    <div className="p-4">
      <div className="h-3 bg-gray-600 rounded w-3/4 mb-2"></div>
      <div className="h-4 bg-gray-600 rounded w-5/6 mb-3"></div>
      <div className="h-5 bg-gray-500 rounded w-1/2"></div>
    </div>
  </div>
);

const ContentList = () => {
  const dispatch = useDispatch();
  const allFilteredItems = useSelector(selectFilteredAndSortedContent);
  const visibleItemCount = useSelector(selectVisibleItemCount);
  const loading = useSelector(selectContentLoading);
  const error = useSelector(selectContentError);
  const hasMore = useSelector(selectHasMore);

  // Items currently displayed based on pagination
  const displayedItems = allFilteredItems.slice(0, visibleItemCount);

  // Ref for the last item in the list for Intersection Observer
  const observerRef = useRef();

  const handleObserver = useCallback((entries) => {
    const target = entries[0];
    if (target.isIntersecting && hasMore && loading === 'succeeded') {
      // Check if more items are available before dispatching
      if (visibleItemCount < allFilteredItems.length) {
        dispatch(loadMoreItems());
      } else {
        dispatch(setHasMore(false)); // No more items to load
      }
    }
  }, [visibleItemCount, allFilteredItems.length, hasMore, loading, dispatch]);

  useEffect(() => {
    const option = {
      root: null, // viewport
      rootMargin: '20px',
      threshold: 0.1,
    };
    const observer = new IntersectionObserver(handleObserver, option);
    if (observerRef.current) {
      observer.observe(observerRef.current);
    }
    return () => {
      if (observerRef.current) {
        observer.unobserve(observerRef.current);
      }
    };
  }, [handleObserver]);

  useEffect(() => {
    // Update hasMore status when allFilteredItems or visibleItemCount changes
    dispatch(setHasMore(visibleItemCount < allFilteredItems.length));
  }, [visibleItemCount, allFilteredItems.length, dispatch]);

  // Initial fetch on component mount
  useEffect(() => {
    dispatch(fetchContent());
  }, [dispatch]);

  if (loading === 'failed') {
    return <div className="text-red-500 p-4 text-center">Error: {error}. Please try again later.</div>;
  }

  return (
    <div className="bg-[#1a1a1a] p-4 my-4 rounded-md shadow-md">
      <h2 className="text-white text-lg font-semibold flex items-center mb-4">
        <span className="text-green-400 mr-2">•</span> Contents List
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {displayedItems.map((item, index) => (
          <ContentCard key={item.id || index} item={item} />
        ))}
        {/* Skeleton UI for initial load or when loading more */}
        {loading === 'pending' && displayedItems.length === 0 && Array.from({ length: ITEMS_PER_LOAD }).map((_, i) => (
          <SkeletonCard key={`skeleton-initial-${i}`} />
        ))}
        {loading === 'succeeded' && hasMore && allFilteredItems.length > visibleItemCount && Array.from({ length: ITEMS_PER_LOAD }).map((_, i) => (
          <SkeletonCard key={`skeleton-more-${i}`} />
        ))}
      </div>

      {/* Observer target element for infinite scroll */}
      {loading === 'succeeded' && hasMore && (
        <div ref={observerRef} className="text-center text-gray-500 py-4">
          Loading more items...
        </div>
      )}
      {loading === 'succeeded' && !hasMore && displayedItems.length > 0 && (
        <div className="text-center text-gray-500 py-4">
          You've reached the end of the list!
        </div>
      )}
       {loading === 'succeeded' && displayedItems.length === 0 && (
        <div className="text-center text-gray-400 py-8 text-lg">
          No items found matching your criteria.
        </div>
      )}
    </div>
  );
};

// Main App Component
const App = () => {
  return (
    <Provider store={store}>
      <div className="min-h-screen bg-[#0f0f0f] font-sans p-4 antialiased">
        <div className="max-w-7xl mx-auto">
          <Header />
          <FilterSection />
          <ContentList />
        </div>
      </div>
    </Provider>
  );
};

export default App;

