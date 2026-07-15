const COORD_CACHE_KEY = "apt_coord_cache";
const CSV_CACHE_KEY = "apt_csv_cache";
const CSV_CACHE_TIME_KEY = "apt_csv_cache_time";

const mapContainer = document.getElementById("map");

const mapOption = {
  center: new kakao.maps.LatLng(37.5665, 126.9780),
  level: 7,
};

const map = new kakao.maps.Map(mapContainer, mapOption);
const ps = new kakao.maps.services.Places();

const zoomControl = new kakao.maps.ZoomControl();
map.addControl(zoomControl, kakao.maps.ControlPosition.RIGHT);

let failedAptList = [];
let apartmentData = [];
let selectedRegion = "";
let overlays = [];
let coordCache = {};
const DETAIL_LEVEL_KEY = "apt_detail_level";

let detailLevel =
  localStorage.getItem(DETAIL_LEVEL_KEY) || "normal";

const savedCoords =
  JSON.parse(localStorage.getItem(COORD_CACHE_KEY) || "{}");

Object.assign(coordCache, savedCoords);
let drawVersion = 0;
let hasMovedToFirstApt = false;
const GOOGLE_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSjdIMxjf_v_rN6a_1Yr1Xt9DFa1oLUWLDWkrEBlTZ9ETonfS9kY2s1I4WhIifuc5dlaspNiec0_XMV/pub?gid=894623892&single=true&output=csv";

document.getElementById("legendToggle").addEventListener("click", () => {
  document.getElementById("legendContent").classList.toggle("hidden");
});

document.getElementById("legendContent").innerHTML = `
  <div class="legend-row"><span style="background:#b7d7ff"></span> 1억 미만</div>
  <div class="legend-row"><span style="background:#9ee7ff"></span> 1억대</div>
  <div class="legend-row"><span style="background:#9effc5"></span> 2억대</div>
  <div class="legend-row"><span style="background:#d9ff8f"></span> 3억대</div>
  <div class="legend-row"><span style="background:#fff176"></span> 4억대</div>
  <div class="legend-row"><span style="background:#ffd54f"></span> 5억대</div>
  <div class="legend-row"><span style="background:#ffb74d"></span> 6억대</div>
  <div class="legend-row"><span style="background:#ff8a65"></span> 7억대</div>
  <div class="legend-row"><span style="background:#f06292"></span> 8억대</div>
  <div class="legend-row"><span style="background:#ba68c8"></span> 9억대</div>
  <div class="legend-row"><span style="background:#9575cd"></span> 10~12억</div>
  <div class="legend-row"><span style="background:#7986cb"></span> 12~14억</div>
  <div class="legend-row"><span style="background:#64b5f6"></span> 14~16억</div>
  <div class="legend-row"><span style="background:#4dd0e1"></span> 16~18억</div>
  <div class="legend-row"><span style="background:#4db6ac"></span> 18~20억</div>
  <div class="legend-row"><span style="background:#80cbc4"></span> 20억 이상</div>
`;


function processCsvRows(rows) {
  const headerIndex = rows.findIndex(row => {
    const cleaned = row.map(cell => clean(cell).replace(/\s+/g, ""));
    return cleaned.includes("단지") && cleaned.includes("매매") && cleaned.includes("전세");
  });

  if (headerIndex === -1) {
    alert("CSV에서 제목줄을 찾지 못했습니다.");
    return;
  }

  const headers = rows[headerIndex].map(h => clean(h).replace(/\s+/g, ""));
  const dataRows = rows.slice(headerIndex + 1);

  apartmentData = dataRows
    .map(row => {
      const obj = {};
      headers.forEach((header, i) => {
        obj[header] = clean(row[i]);
      });
      return obj;
    })
    .filter(row => {
      return (
        row["단지"] &&
        !row["단지"].includes("#REF") &&
        !row["시"]?.includes("#REF") &&
        !row["구"]?.includes("#REF")
      );
    });

  hasMovedToFirstApt = false;
  makeRegionSelect();
}

function showLoading(
  message = "아파트 시세 데이터를 불러오는 중입니다."
) {
  const loadingOverlay =
    document.getElementById("loadingOverlay");

  const loadingText =
    document.getElementById("loadingText");

  if (!loadingOverlay || !loadingText) {
    return;
  }

  loadingText.textContent = message;
  loadingOverlay.classList.remove("hidden");
}

function hideLoading() {
  const loadingOverlay =
    document.getElementById("loadingOverlay");

  if (!loadingOverlay) {
    return;
  }

  loadingOverlay.classList.add("hidden");
}


function saveCsvCache(csvText) {
  try {
    localStorage.setItem(
      CSV_CACHE_KEY,
      csvText
    );

    localStorage.setItem(
      CSV_CACHE_TIME_KEY,
      String(Date.now())
    );

    console.log("CSV 브라우저 캐시 저장 완료");
  } catch (error) {
    console.warn(
      "CSV 브라우저 캐시 저장 실패:",
      error
    );
  }
}

function getCachedCsv() {
  try {
    return localStorage.getItem(
      CSV_CACHE_KEY
    );
  } catch (error) {
    console.warn(
      "CSV 브라우저 캐시 읽기 실패:",
      error
    );

    return null;
  }
}

function removeCsvCache() {
  try {
    localStorage.removeItem(
      CSV_CACHE_KEY
    );

    localStorage.removeItem(
      CSV_CACHE_TIME_KEY
    );
  } catch (error) {
    console.warn(
      "CSV 브라우저 캐시 삭제 실패:",
      error
    );
  }
}

function parseCsvText(csvText, sourceName = "CSV") {
  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: false,
      skipEmptyLines: true,

      complete: function (results) {
        console.log(
          `${sourceName} 파싱 완료:`,
          results.data.length
        );

        processCsvRows(results.data);
        resolve(results.data);
      },

      error: function (error) {
        console.error(
          `${sourceName} 파싱 실패:`,
          error
        );

        reject(error);
      },
    });
  });
}

async function fetchCsvWithTimeout(
  url,
  timeoutMs = 15000
) {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-cache",
      credentials: "omit",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `CSV 요청 실패: ${response.status} ${response.statusText}`
      );
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchLatestCsv() {
  try {
    return await fetchCsvWithTimeout(
      GOOGLE_SHEET_CSV_URL,
      15000
    );
  } catch (firstError) {
    console.warn(
      "첫 번째 CSV 요청 실패. 다시 시도합니다.",
      firstError
    );

    const retryUrl =
      GOOGLE_SHEET_CSV_URL +
      "&t=" +
      Date.now();

    return await fetchCsvWithTimeout(
      retryUrl,
      15000
    );
  }
}

async function loadGoogleSheetCsv() {
  console.log("구글 시트 불러오기 시작");

  const cachedCsv = getCachedCsv();

  /*
   * 이전에 성공한 CSV가 있으면
   * 먼저 즉시 화면에 표시한다.
   */
  if (cachedCsv) {
    showLoading(
      "저장된 아파트 시세 데이터를 불러오는 중입니다."
    );

    try {
      await parseCsvText(
        cachedCsv,
        "저장된 CSV"
      );

      hideLoading();
    } catch (cacheError) {
      console.warn(
        "저장된 CSV를 사용하지 못했습니다.",
        cacheError
      );

      removeCsvCache();

      /*
       * 손상된 캐시를 지운 뒤
       * 최신 데이터를 다시 불러온다.
       */
      await loadLatestCsvForFirstVisit();
      return;
    }

    /*
     * 화면은 이미 표시했으므로
     * 최신 데이터는 뒤에서 확인한다.
     */
    fetchLatestCsv()
      .then(async latestCsv => {
        if (latestCsv === cachedCsv) {
          console.log(
            "저장된 CSV가 최신 상태입니다."
          );

          return;
        }

        console.log(
          "새로운 구글시트 데이터를 발견했습니다."
        );

        saveCsvCache(latestCsv);

        /*
         * 사용자가 아직 지도 조작을 시작하지 않은 경우에만
         * 화면 데이터를 최신 CSV로 다시 구성한다.
         */
        const currentSelectedRegion =
          selectedRegion;

        await parseCsvText(
          latestCsv,
          "최신 CSV"
        );

        /*
         * makeRegionSelect()가 첫 지역으로 변경하므로
         * 기존 선택 지역이 여전히 존재하면 복구한다.
         */
        if (currentSelectedRegion) {
          const regionSelect =
            document.getElementById("regionSelect");

          const regionStillExists = [
            ...regionSelect.options,
          ].some(
            option =>
              option.value === currentSelectedRegion
          );

          if (regionStillExists) {
            selectedRegion =
              currentSelectedRegion;

            regionSelect.value =
              currentSelectedRegion;

            hasMovedToFirstApt = false;

            renderApartmentList();
            drawSelectedRegion(true);
          }
        }
      })
      .catch(error => {
        /*
         * 최신 데이터 확인이 실패해도
         * 저장된 데이터로 계속 사용한다.
         */
        console.warn(
          "최신 CSV 백그라운드 갱신 실패:",
          error
        );
      });

    return;
  }

  /*
   * 처음 방문하거나 캐시가 없을 때만
   * 구글시트 응답을 기다린다.
   */
  await loadLatestCsvForFirstVisit();
}

async function loadLatestCsvForFirstVisit() {
  showLoading(
    "최신 아파트 시세 데이터를 처음 불러오는 중입니다."
  );

  try {
    console.time("최초 CSV 다운로드");

    const latestCsv =
      await fetchLatestCsv();

    console.timeEnd("최초 CSV 다운로드");

    saveCsvCache(latestCsv);

    await parseCsvText(
      latestCsv,
      "최초 CSV"
    );

    hideLoading();
  } catch (error) {
    console.error(
      "구글 시트 CSV 최종 불러오기 실패:",
      error
    );

    hideLoading();

    alert(
      "아파트 시세 데이터를 불러오지 못했습니다.\n" +
      "잠시 후 새로고침하거나 CSV 직접 업로드를 이용해 주세요."
    );
  }
}

loadGoogleSheetCsv();

document.getElementById("csvUploadInput").addEventListener("change", function (event) {
  const file = event.target.files[0];

  if (!file) return;

  Papa.parse(file, {
    header: false,
    skipEmptyLines: true,
    complete: function (results) {
      console.log("직접 업로드 CSV 결과:", results.data);

      clearOverlays();
      apartmentData = [];
      selectedRegion = "";
      hasMovedToFirstApt = false;

      processCsvRows(results.data);

      alert("CSV 파일을 불러왔습니다. 새로고침하면 다시 구글시트 데이터로 돌아갑니다.");
    },
    error: function (error) {
      console.error("CSV 업로드 실패:", error);
      alert("CSV 파일을 불러오지 못했습니다.");
    },
  });

  event.target.value = "";
});

function makeRegionSelect() {
  const regionSelect = document.getElementById("regionSelect");

  regionSelect.innerHTML = `
    <option value="">전체 지역</option>
  `;

  const regions = [
    ...new Set(
      apartmentData
        .map(row => makeRegionName(row))
        .filter(Boolean)
    ),
  ].sort();

  regions.forEach(region => {
    const option = document.createElement("option");

    option.value = region;
    option.textContent = region;

    regionSelect.appendChild(option);
  });

  /*
   * 처음 접속했을 때 전국 단지를 모두 불러오면
   * 속도가 느려질 수 있으므로 첫 번째 지역을 기본 표시한다.
   *
   * 사용자가 '전체 지역'을 직접 선택하면
   * selectedRegion이 빈 문자열이 되어 전국 단지를 표시한다.
   */
  if (regions.length > 0) {
    selectedRegion = regions[0];
    regionSelect.value = selectedRegion;

    renderApartmentList();
    drawSelectedRegion(true);
  }
}

function makeRegionName(row) {
  const city = clean(row["시"]);
  const gu = clean(row["구"]);

  if (city && gu) return `${city} ${gu}`;
  if (city) return city;
  if (gu) return gu;
  return "";
}

// 좌표 검색용: 같은 단지면 같은 좌표 사용
function makeAptKey(row) {
  return `${clean(row["시"])}|${clean(row["구"])}|${clean(row["동"])}|${clean(row["단지"])}`;
}

// 체크박스/평형 구분용: 같은 단지의 여러 평형도 각각 유지
function makeRowKey(row) {
  return `${clean(row["시"])}|${clean(row["구"])}|${clean(row["동"])}|${clean(row["단지"])}|${clean(row["평형"])}|${clean(row["매매"])}|${clean(row["전세"])}|${clean(row["전고점"])}`;
}

document.getElementById("regionSelect").addEventListener("change", function () {
  selectedRegion = this.value;
  hasMovedToFirstApt = false;
  renderApartmentList();
  drawSelectedRegion(true);
});

document.getElementById("searchInput").addEventListener("input", function () {
  renderApartmentList();
  drawSelectedRegion();
});

function updateDetailModeButtons() {
  document
    .querySelectorAll(".detail-mode-btn")
    .forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.level === detailLevel
      );
    });
}

document
  .querySelectorAll(".detail-mode-btn")
  .forEach(button => {
    button.addEventListener("click", function () {
      detailLevel = this.dataset.level;

      localStorage.setItem(
        DETAIL_LEVEL_KEY,
        detailLevel
      );

      updateDetailModeButtons();
      drawSelectedRegion();
    });
  });

updateDetailModeButtons();

document.getElementById("selectAllBtn").addEventListener("click", function () {
  // 평형대 전체 선택
  document.querySelectorAll(".sizeCheck").forEach(cb => {
    cb.checked = true;
  });

  // 선택된 평형대 기준으로 단지 목록 다시 생성
  renderApartmentList();

  // 현재 표시된 단지 전체 선택
  document.querySelectorAll(".apt-check").forEach(cb => {
    cb.checked = true;
  });

  drawSelectedRegion();
});

document.getElementById("unselectAllBtn").addEventListener("click", function () {
  // 평형대 전체 해제
  document.querySelectorAll(".sizeCheck").forEach(cb => {
    cb.checked = false;
  });

  // 평형대가 모두 해제된 상태로 단지 목록 갱신
  renderApartmentList();

  // 지도 정보박스 제거
  drawSelectedRegion();
});

document.getElementById("priceToggle").addEventListener("click", function () {
  document.getElementById("priceContent").classList.toggle("hidden");
});

document.getElementById("applyPriceBtn").addEventListener("click", function () {
  renderApartmentList();
  drawSelectedRegion();
});

document.querySelectorAll(".sizeCheck").forEach(cb => {
  cb.addEventListener("change", () => {
    renderApartmentList();
    drawSelectedRegion();
  });
});

function getFilteredApartments() {
  const searchText = clean(
    document.getElementById("searchInput").value
  );

  const checkedSizes = [
    ...document.querySelectorAll(".sizeCheck:checked"),
  ].map(el => Number(el.value));

  const minPriceInput =
    document.getElementById("minPriceInput").value.trim();

  const maxPriceInput =
    document.getElementById("maxPriceInput").value.trim();

  const parsedMinPrice = Number(minPriceInput);
  const parsedMaxPrice = Number(maxPriceInput);

  const minPrice =
    minPriceInput !== "" && Number.isFinite(parsedMinPrice)
      ? parsedMinPrice
      : 0;

  const maxPrice =
    maxPriceInput !== "" && Number.isFinite(parsedMaxPrice)
      ? parsedMaxPrice
      : 200;

  return apartmentData.filter(row => {
    const region = makeRegionName(row);
    const aptName = clean(row["단지"]);

    const regionMatch =
      selectedRegion
        ? region === selectedRegion
        : true;

    const searchMatch =
      searchText
        ? aptName.includes(searchText)
        : true;

    const pyeong =
      parseInt(clean(row["평형"])) || 0;

    let sizeGroup =
      Math.floor(pyeong / 10) * 10;

    if (sizeGroup >= 50) {
      sizeGroup = 50;
    }

    const sizeMatch =
      checkedSizes.includes(sizeGroup);

    const priceEok =
      parsePriceToEok(row["매매"]);

    const priceMatch =
      priceEok >= minPrice &&
      priceEok <= maxPrice;

    return (
      regionMatch &&
      searchMatch &&
      sizeMatch &&
      priceMatch
    );
  });
}

function renderApartmentList() {
  const aptList = document.getElementById("aptList");
  const aptCount = document.getElementById("aptCount");

  aptList.innerHTML = "";

  const filtered = getFilteredApartments();
  aptCount.textContent = filtered.length;

  filtered.forEach(row => {
    const rowKey = makeRowKey(row);

    const item = document.createElement("div");
    item.className = "apt-item";

    item.innerHTML = `
      <label>
        <input type="checkbox" class="apt-check" checked data-key="${rowKey}" />
        <div class="apt-card">
          <div class="apt-name">${clean(row["단지"])}</div>
          <div class="apt-dong">${clean(row["동"])}</div>
          <div class="apt-info">${clean(row["연식"])}년 · ${clean(row["전체세대수"])}세대</div>
          <div class="apt-price">${clean(row["평형"])}평 · ${clean(row["계/복"])} 방${clean(row["방"])} 화${clean(row["화"])}</div>
          <div class="apt-price">매매 ${clean(row["매매"])} / 전세 ${clean(row["전세"])} / ${clean(row["전세가율"])}</div>
          <div class="apt-price">매매 ${clean(row["매매개수"])}개 / 전세 ${clean(row["전세개수"])}개</div>
          <div class="apt-price">전고점 ${clean(row["전고점"])} / 하락률 ${clean(row["현재하락률"])}</div>
        </div>
      </label>
    `;

    aptList.appendChild(item);
  });

  document.querySelectorAll(".apt-check").forEach(checkbox => {
    checkbox.addEventListener("change", drawSelectedRegion);
  });
}

function getCheckedRowKeys() {
  return [...document.querySelectorAll(".apt-check:checked")]
    .map(input => input.dataset.key);
}

function clearOverlays() {
  overlays.forEach(overlay => overlay.setMap(null));
  overlays = [];
}

function drawSelectedRegion(moveToFirst = false) {
  drawVersion++;
  const currentVersion = drawVersion;

  failedAptList = [];
  if (moveToFirst) {
    hasMovedToFirstApt = false;
  }

  clearOverlays();

  const checkedKeys = getCheckedRowKeys();

  const rows = getFilteredApartments().filter(row =>
    checkedKeys.includes(makeRowKey(row))
  );

  const groups = groupByApt(rows);

  Object.keys(groups).forEach(aptKey => {
    const groupRows = groups[aptKey];

    if (coordCache[aptKey]) {
      const saved = coordCache[aptKey];

      const position = new kakao.maps.LatLng(
        Number(saved.lat),
        Number(saved.lng)
      );

      drawGroup(groupRows, position);

      if (moveToFirst && !hasMovedToFirstApt) {
        map.setCenter(position);
        map.setLevel(5);
        hasMovedToFirstApt = true;
      }

      return;
    }

    searchApartmentPosition(
      groupRows,
      currentVersion,
      moveToFirst
    );
  });

  setTimeout(() => {
    if (failedAptList.length > 0) {
      console.warn(
        "최종 좌표 검색 실패 목록:",
        [...new Set(failedAptList)]
      );
    }
  }, 3000);
}

function groupByApt(rows) {
  const groups = {};

  rows.forEach(row => {
    const aptKey = makeAptKey(row);

    if (!groups[aptKey]) {
      groups[aptKey] = [];
    }

    groups[aptKey].push(row);
  });

  return groups;
}

function searchApartmentPosition(
  groupRows,
  version,
  moveToFirst = false
) {
  const row = groupRows[0];
  const aptKey = makeAptKey(row);

  const lat = Number(clean(row["위도"]));
  const lng = Number(clean(row["경도"]));

  /*
   * 검색이 진행되는 동안 사용자가 다른 지역을 선택했다면
   * 이전 검색 결과는 지도에 표시하지 않는다.
   */
  if (version !== drawVersion) {
    return;
  }

  /*
   * 스프레드시트에 위도·경도가 있으면
   * 카카오 검색 없이 바로 사용한다.
   */
  if (lat && lng) {
    const position = new kakao.maps.LatLng(lat, lng);

    coordCache[aptKey] = {
      lat: position.getLat(),
      lng: position.getLng(),
    };

    localStorage.setItem(
      COORD_CACHE_KEY,
      JSON.stringify(coordCache)
    );

    drawGroup(groupRows, position);

    if (moveToFirst && !hasMovedToFirstApt) {
      map.setCenter(position);
      map.setLevel(5);
      hasMovedToFirstApt = true;
    }

    return;
  }

  const city = clean(row["시"]);
  const gu = clean(row["구"]);
  const dong = clean(row["동"]);
  const aptName = clean(row["단지"]);

  const cleanAptName = aptName
    .replace(/\(.*?\)/g, "")
    .trim();

  const keywords = [
    `${city} ${gu} ${dong} ${aptName}`,
    `${city} ${gu} ${dong} ${cleanAptName}`,
    `${gu} ${dong} ${cleanAptName}`,
    `${dong} ${cleanAptName}`,
    cleanAptName,
  ];

  searchKeywordList(
    keywords,
    0,
    function (position) {
      /*
       * 검색 도중 다른 지역이 선택됐다면
       * 오래된 검색 결과를 무시한다.
       */
      if (version !== drawVersion) {
        return;
      }

      if (!position) {
        const failedName =
          `${city} ${gu} ${dong} ${aptName}`;

        failedAptList.push(failedName);

        console.log(
          "좌표 검색 실패:",
          failedName
        );

        return;
      }

      coordCache[aptKey] = {
        lat: position.getLat(),
        lng: position.getLng(),
      };

      localStorage.setItem(
        COORD_CACHE_KEY,
        JSON.stringify(coordCache)
      );

      drawGroup(groupRows, position);

      if (moveToFirst && !hasMovedToFirstApt) {
        map.setCenter(position);
        map.setLevel(5);
        hasMovedToFirstApt = true;
      }
    }
  );
}

function searchKeywordList(keywords, index, callback) {
  if (index >= keywords.length) {
    callback(null);
    return;
  }

  ps.keywordSearch(keywords[index], function (data, status) {
    if (status === kakao.maps.services.Status.OK && data.length > 0) {
      const place = data[0];
      callback(new kakao.maps.LatLng(place.y, place.x));
    } else {
      searchKeywordList(keywords, index + 1, callback);
    }
  });
}

function drawGroup(groupRows, position) {
  const sortedRows = [...groupRows].sort((a, b) => {
    const pa = parseInt(clean(a["평형"])) || 0;
    const pb = parseInt(clean(b["평형"])) || 0;
    return pa - pb;
  });

  const total = sortedRows.length;

  sortedRows.forEach((row, index) => {
    createOverlay(row, position, index, total);
  });
}

function createOverlay(row, position, offsetIndex = 0, totalCount = 1) {
  const offset = getOverlayOffset(offsetIndex, totalCount);

  const overlay = new kakao.maps.CustomOverlay({
    position,
    content: makeOverlayContent(row, offset.x, offset.y),
    yAnchor: 1,
    xAnchor: 0.5,
  });

  overlay.setMap(map);
  overlays.push(overlay);
}

function getOverlayOffset(index, total) {
  if (total <= 1) {
    return { x: 0, y: 0 };
  }

  const level = map.getLevel();

  let gapX = 195;
  let gapY = 95;

  if (level >= 8) {
    gapX = 110;
    gapY = 60;
  } else if (level >= 6) {
    gapX = 145;
    gapY = 80;
  }

  let columns = total;

  if (total >= 3 && total <= 7) {
    columns = 2;
  } else if (total >= 8) {
    columns = 3;
  }

  const rowIndex = Math.floor(index / columns);
  const colIndex = index % columns;

  const lastRowIndex = Math.floor((total - 1) / columns);

  const currentRowCount =
    rowIndex === lastRowIndex
      ? total - rowIndex * columns
      : columns;

  const startX = -((currentRowCount - 1) * gapX) / 2;

  return {
    x: startX + colIndex * gapX,
    y: rowIndex * gapY,
  };
}

let collisionTimer = null;


function getCurrentDetailLevel() {
  return detailLevel;
}

function makeOverlayContent(row, offsetX = 0, offsetY = 0) {
  const currentDetail = getCurrentDetailLevel();
  const bgColor = getPriceColor(row["매매"]);

  const name = clean(row["단지"]);
  const pyeong = clean(row["평형"]);
  const sale = formatPrice(row["매매"]);
  const rent = formatPrice(row["전세"]);
  const rentRate = clean(row["전세가율"]);

  const baseAttrs = `
    data-base-x="${offsetX}"
    data-base-y="${offsetY}"
    style="background:${bgColor}; transform: translate(${offsetX}px, ${offsetY}px);"
  `;

  if (currentDetail === "summary") {
    return `
      <div class="apt-overlay tiny" ${baseAttrs}>
        <div class="overlay-name">${name}</div>
        <div class="overlay-price">${pyeong}평 · ${sale}</div>
      </div>
    `;
  }

  if (currentDetail === "normal") {
    return `
      <div class="apt-overlay middle" ${baseAttrs}>
        <div class="overlay-name">${name}</div>
        <div class="overlay-price">${pyeong}평 · 매매 ${sale}</div>
        <div class="overlay-price">전세 ${rent} (${rentRate})</div>
      </div>
    `;
  }

  return `
    <div class="apt-overlay detail" ${baseAttrs}>
      <div class="overlay-name">${name}</div>
      <div class="overlay-detail">${clean(row["연식"])}년 · ${clean(row["전체세대수"])}세대</div>
      <div class="overlay-detail">${pyeong}평 · ${clean(row["계/복"])} 방${clean(row["방"])} 화${clean(row["화"])}</div>
      <div class="overlay-price">
        매매 ${sale}(${clean(row["매매개수"])}) / 전세 ${rent}(${clean(row["전세개수"])}) (${rentRate})
      </div>
      <div class="overlay-detail">
        전고 ${formatPrice(row["전고점"])} / 하락률 ${clean(row["현재하락률"])}
      </div>
    </div>
  `;
}

function getPriceColor(priceText) {
  const price = parsePriceToEok(priceText);

  if (price < 1) return "#b7d7ff";
  if (price < 2) return "#9ee7ff";
  if (price < 3) return "#9effc5";
  if (price < 4) return "#d9ff8f";
  if (price < 5) return "#fff176";
  if (price < 6) return "#ffd54f";
  if (price < 7) return "#ffb74d";
  if (price < 8) return "#ff8a65";
  if (price < 9) return "#f06292";
  if (price < 10) return "#ba68c8";
  if (price < 12) return "#9575cd";
  if (price < 14) return "#7986cb";
  if (price < 16) return "#64b5f6";
  if (price < 18) return "#4dd0e1";
  if (price < 20) return "#4db6ac";
  return "#80cbc4";
}

function parsePriceToEok(priceText) {
  if (!priceText) return 0;

  const text = String(priceText).replace(/,/g, "").trim();

  if (text.includes("억")) {
    const eokMatch = text.match(/(\d+(\.\d+)?)억/);
    const manMatch = text.match(/억\s*(\d+)/);

    const eok = eokMatch ? Number(eokMatch[1]) : 0;
    const man = manMatch ? Number(manMatch[1]) / 10000 : 0;

    return eok + man;
  }

  const num = Number(text.replace(/[^\d.]/g, ""));

  if (!num) return 0;

  return num / 10000;
}

let zoomTimer = null;

function redrawOverlayByMapChange() {
  clearTimeout(zoomTimer);

  zoomTimer = setTimeout(() => {
    drawSelectedRegion();
  }, 150);
}

kakao.maps.event.addListener(map, "zoom_changed", redrawOverlayByMapChange);
kakao.maps.event.addListener(map, "idle", redrawOverlayByMapChange);

const sidePanel = document.querySelector(".side-panel");
const resizeHandle = document.getElementById("resizeHandle");

let isResizing = false;

resizeHandle.addEventListener("mousedown", function () {
  isResizing = true;
  document.body.style.cursor = "col-resize";
});

document.addEventListener("mousemove", function (e) {
  if (!isResizing) return;

  const newWidth = e.clientX;

  if (newWidth >= 260 && newWidth <= 560) {
    sidePanel.style.width = newWidth + "px";
  }
});

document.addEventListener("mouseup", function () {
  isResizing = false;
  document.body.style.cursor = "default";
});

document.getElementById("mapTypeSelect").addEventListener("change", function () {
  map.removeOverlayMapTypeId(kakao.maps.MapTypeId.TERRAIN);

  if (this.value === "basic") {
    map.setMapTypeId(kakao.maps.MapTypeId.ROADMAP);
  }

  if (this.value === "skyview") {
    map.setMapTypeId(kakao.maps.MapTypeId.HYBRID);
  }

  if (this.value === "terrain") {
    map.setMapTypeId(kakao.maps.MapTypeId.ROADMAP);
    map.addOverlayMapTypeId(kakao.maps.MapTypeId.TERRAIN);
  }
});

document.getElementById("captureBtn").addEventListener("click", function () {
  alert(
    "자동 저장은 지도 보안 정책 때문에 정확하지 않을 수 있습니다.\n\n" +
    "정확한 저장 방법:\n" +
    "1. Win + Shift + S 누르기\n" +
    "2. 저장할 지도 영역 드래그\n" +
    "3. 이미지로 저장하기"
  );
});

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function formatPrice(value) {
  const text = clean(value).replace(/,/g, "");

  if (!text || text === "0") return "0";

  const num = Number(text);

  if (!num) return clean(value);

  const eok = num / 10000;

  if (Number.isInteger(eok)) {
    return `${eok}억`;
  }

  return `${eok.toFixed(1)}억`;
}

const OVERLAY_FONT_SCALE_KEY = "apt_overlay_font_scale";

let overlayFontScale =
  Number(localStorage.getItem(OVERLAY_FONT_SCALE_KEY)) || 1;

function applyOverlayFontScale() {
  document.documentElement.style.setProperty(
    "--overlay-font-scale",
    String(overlayFontScale)
  );

  document.getElementById("fontSizeValue").textContent =
    `${Math.round(overlayFontScale * 100)}%`;

  localStorage.setItem(
    OVERLAY_FONT_SCALE_KEY,
    String(overlayFontScale)
  );
}

document
  .getElementById("fontSizeDownBtn")
  .addEventListener("click", function () {
    overlayFontScale = Math.max(
      0.8,
      Number((overlayFontScale - 0.1).toFixed(1))
    );

    applyOverlayFontScale();
  });

document
  .getElementById("fontSizeUpBtn")
  .addEventListener("click", function () {
    overlayFontScale = Math.min(
      1.8,
      Number((overlayFontScale + 0.1).toFixed(1))
    );

    applyOverlayFontScale();
  });

document
  .getElementById("fontSizeResetBtn")
  .addEventListener("click", function () {
    overlayFontScale = 1;
    applyOverlayFontScale();
  });

applyOverlayFontScale();