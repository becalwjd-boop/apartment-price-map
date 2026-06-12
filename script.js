const mapContainer = document.getElementById("map");

const mapOption = {
  center: new kakao.maps.LatLng(37.5665, 126.9780),
  level: 7,
};

const map = new kakao.maps.Map(mapContainer, mapOption);
const ps = new kakao.maps.services.Places();

const zoomControl = new kakao.maps.ZoomControl();
map.addControl(zoomControl, kakao.maps.ControlPosition.RIGHT);

let apartmentData = [];
let selectedRegion = "";
let overlays = [];
let coordCache = {};
let drawVersion = 0;
let hasMovedToFirstApt = false;

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
  <div class="legend-row"><span style="background:#9575cd"></span> 10억 이상</div>
`;

document.getElementById("csvInput").addEventListener("change", function (event) {
  const file = event.target.files[0];
  if (!file) return;

  Papa.parse(file, {
    header: false,
    skipEmptyLines: true,
    encoding: "UTF-8",
    complete: function (results) {
      const rows = results.data;

      const headerIndex = rows.findIndex(row =>
        row.includes("군") &&
        row.includes("시") &&
        row.includes("구") &&
        row.includes("단지")
      );

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
        .filter(row => row["단지"]);

      hasMovedToFirstApt = false;
      makeRegionSelect();
    },
  });
});

function makeRegionSelect() {
  const regionSelect = document.getElementById("regionSelect");
  regionSelect.innerHTML = `<option value="">지역 선택</option>`;

  const regions = [...new Set(
    apartmentData.map(row => makeRegionName(row)).filter(Boolean)
  )].sort();

  regions.forEach(region => {
    const option = document.createElement("option");
    option.value = region;
    option.textContent = region;
    regionSelect.appendChild(option);
  });

  if (regions.length > 0) {
    selectedRegion = regions[0];
    regionSelect.value = selectedRegion;
    renderApartmentList();
    drawSelectedRegion();
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
  drawSelectedRegion();
});

document.getElementById("searchInput").addEventListener("input", function () {
  renderApartmentList();
  drawSelectedRegion();
});

document.getElementById("selectAllBtn").addEventListener("click", function () {

  document.querySelectorAll(".apt-check").forEach(cb => {
    cb.checked = true;
  });

  drawSelectedRegion();
});

document.getElementById("unselectAllBtn").addEventListener("click", function () {

  document.querySelectorAll(".apt-check").forEach(cb => {
    cb.checked = false;
  });

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
  const searchText = clean(document.getElementById("searchInput").value);

  const checkedSizes = [...document.querySelectorAll(".sizeCheck:checked")]
    .map(el => Number(el.value));

  const minPrice = Number(document.getElementById("minPriceInput").value) || 1;
  const maxPrice = Number(document.getElementById("maxPriceInput").value) || 50;

  return apartmentData.filter(row => {
    const region = makeRegionName(row);
    const aptName = clean(row["단지"]);

    const regionMatch =
      selectedRegion ? region === selectedRegion : true;

    const searchMatch =
      searchText ? aptName.includes(searchText) : true;

    const pyeong =
      parseInt(clean(row["평형"])) || 0;

    let sizeGroup =
      Math.floor(pyeong / 10) * 10;

    if (sizeGroup >= 50) {
      sizeGroup = 50;
    }

    const sizeMatch =
      checkedSizes.includes(sizeGroup);

    const priceEok = parsePriceToEok(row["매매"]);

    const priceMatch =
      priceEok >= minPrice && priceEok < maxPrice + 1;

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

function drawSelectedRegion() {
  drawVersion++;
  const currentVersion = drawVersion;

  clearOverlays();

  const checkedKeys = getCheckedRowKeys();

  const rows = getFilteredApartments().filter(row =>
    checkedKeys.includes(makeRowKey(row))
  );

  const groups = groupByApt(rows);

  Object.keys(groups).forEach(aptKey => {
    const groupRows = groups[aptKey];

    if (coordCache[aptKey]) {
      drawGroup(groupRows, coordCache[aptKey]);
      return;
    }

    searchApartmentPosition(groupRows, currentVersion);
  });
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

function searchApartmentPosition(groupRows, version) {
  const row = groupRows[0];

  const aptKey = makeAptKey(row);

  const city = clean(row["시"]);
  const gu = clean(row["구"]);
  const dong = clean(row["동"]);
  const aptName = clean(row["단지"]);

  const keyword = `${city} ${gu} ${dong} ${aptName}`;

  ps.keywordSearch(keyword, function (data, status) {
    if (version !== drawVersion) return;

    if (status !== kakao.maps.services.Status.OK || data.length === 0) {
      console.log("좌표 검색 실패:", keyword);
      return;
    }

    const place = data[0];
    const position = new kakao.maps.LatLng(place.y, place.x);

    coordCache[aptKey] = position;

    drawGroup(groupRows, position);

    if (!hasMovedToFirstApt) {
      map.setCenter(position);
      map.setLevel(5);
      hasMovedToFirstApt = true;
    }
  });
}

function drawGroup(groupRows, position) {
  const total = groupRows.length;

  groupRows.forEach((row, index) => {
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

  let gap = 190;

  if (level >= 8) gap = 95;
  else if (level >= 6) gap = 145;
  else gap = 190;

  const positions = [
    { x: 0, y: 0 },
    { x: gap, y: 0 },
    { x: -gap, y: 0 },
    { x: 0, y: -gap },
    { x: 0, y: gap },

    { x: gap, y: -gap },
    { x: -gap, y: -gap },
    { x: gap, y: gap },
    { x: -gap, y: gap },

    { x: gap * 2, y: 0 },
    { x: -gap * 2, y: 0 },
    { x: 0, y: -gap * 2 },
    { x: 0, y: gap * 2 },

    { x: gap * 2, y: -gap },
    { x: -gap * 2, y: -gap },
    { x: gap * 2, y: gap },
    { x: -gap * 2, y: gap },

    { x: gap, y: -gap * 2 },
    { x: -gap, y: -gap * 2 },
    { x: gap, y: gap * 2 },
    { x: -gap, y: gap * 2 },

    { x: gap * 3, y: 0 },
    { x: -gap * 3, y: 0 },
    { x: 0, y: -gap * 3 },
    { x: 0, y: gap * 3 },
    ];

  return positions[index] || {
    x: ((index % 5) - 2) * gap,
    y: Math.floor(index / 5) * gap,
  };
}

function makeOverlayContent(row, offsetX = 0, offsetY = 0) {
  const level = map.getLevel();

  let zoomClass = "detail";

  if (level >= 8) zoomClass = "simple";
  else if (level >= 6) zoomClass = "middle";

  const bgColor = getPriceColor(row["매매"]);

  return `
    <div class="apt-overlay ${zoomClass}" style="background:${bgColor}; transform: translate(${offsetX}px, ${offsetY}px);">
      <div class="overlay-name">${clean(row["단지"])}</div>
      <div class="overlay-detail detail-only">${clean(row["연식"])}년 · ${clean(row["전체세대수"])}세대</div>
      <div class="overlay-detail detail-only">${clean(row["평형"])}평 · ${clean(row["계/복"])} 방${clean(row["방"])} 화${clean(row["화"])}</div>
      <div class="overlay-price">
        매매 ${formatPrice(row["매매"])}(${clean(row["매매개수"])}) / 전세 ${formatPrice(row["전세"])}(${clean(row["전세개수"])}) (${clean(row["전세가율"])})
      </div>
      <div class="overlay-detail middle-hide">
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
  return "#9575cd";
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

kakao.maps.event.addListener(map, "zoom_changed", function () {
  clearTimeout(zoomTimer);

  zoomTimer = setTimeout(() => {
    drawSelectedRegion();
  }, 250);
});

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