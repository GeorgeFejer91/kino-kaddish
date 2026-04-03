(function (global) {
  "use strict";

  var fontStateCache = new Map();
  var graphemeSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

  function getFontState(font) {
    var cached = fontStateCache.get(font);
    if (cached) {
      return cached;
    }

    var canvas = document.createElement("canvas");
    var context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is required for Pretext measurements.");
    }

    context.font = font;

    var state = {
      context: context,
      widthCache: new Map(),
    };

    fontStateCache.set(font, state);
    return state;
  }

  function clearCache() {
    fontStateCache.clear();
  }

  function measureTextWidth(text, fontState) {
    var cached = fontState.widthCache.get(text);
    if (cached !== undefined) {
      return cached;
    }

    var width = fontState.context.measureText(text).width;
    fontState.widthCache.set(text, width);
    return width;
  }

  function getGraphemes(text) {
    if (text === "") {
      return [];
    }

    if (graphemeSegmenter) {
      return Array.from(graphemeSegmenter.segment(text), function (entry) {
        return entry.segment;
      });
    }

    return Array.from(text);
  }

  function normalizeText(text, whiteSpace) {
    var normalized = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
    if (whiteSpace === "pre-wrap") {
      return normalized.replace(/\t/g, "        ");
    }
    return normalized.replace(/\s+/g, " ").trim();
  }

  function tokenizeText(text, whiteSpace) {
    if (text === "") {
      return [];
    }

    var pattern = whiteSpace === "pre-wrap"
      ? /\n|[^\S\n]+|[^\s\n]+/g
      : /[^\S\n]+|[^\s\n]+/g;

    return text.match(pattern) || [];
  }

  function getSegmentKind(segment) {
    if (segment === "\n") {
      return "hardBreak";
    }
    if (/^[^\S\n]+$/.test(segment)) {
      return "space";
    }
    return "text";
  }

  function prepareWithSegments(text, font, options) {
    var whiteSpace = options && options.whiteSpace === "pre-wrap" ? "pre-wrap" : "normal";
    var normalized = normalizeText(text, whiteSpace);
    var fontState = getFontState(font);
    var rawSegments = tokenizeText(normalized, whiteSpace);
    var segments = [];
    var kinds = [];
    var widths = [];
    var graphemeWidths = [];

    for (var i = 0; i < rawSegments.length; i += 1) {
      var segment = rawSegments[i];
      var kind = getSegmentKind(segment);

      segments.push(segment);
      kinds.push(kind);
      widths.push(measureTextWidth(segment, fontState));

      if (kind === "text") {
        var graphemes = getGraphemes(segment);
        graphemeWidths.push(graphemes.map(function (grapheme) {
          return measureTextWidth(grapheme, fontState);
        }));
      } else {
        graphemeWidths.push(null);
      }
    }

    return {
      font: font,
      whiteSpace: whiteSpace,
      segments: segments,
      kinds: kinds,
      widths: widths,
      graphemeWidths: graphemeWidths,
    };
  }

  function walkLineRanges(prepared, maxWidth, onLine) {
    var limit = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : Infinity;
    var segments = prepared.segments || [];
    var kinds = prepared.kinds || [];
    var widths = prepared.widths || [];
    var graphemeWidths = prepared.graphemeWidths || [];

    var lineWidth = 0;
    var lineStartSegmentIndex = 0;
    var lineStartGraphemeIndex = 0;
    var hasContent = false;
    var lineCount = 0;

    function emitLine(endSegmentIndex, endGraphemeIndex, forcedEmpty) {
      if (!hasContent && !forcedEmpty) {
        return;
      }

      onLine({
        width: lineWidth,
        start: {
          segmentIndex: lineStartSegmentIndex,
          graphemeIndex: lineStartGraphemeIndex,
        },
        end: {
          segmentIndex: endSegmentIndex,
          graphemeIndex: endGraphemeIndex,
        },
      });

      lineCount += 1;
      lineWidth = 0;
      hasContent = false;
      lineStartSegmentIndex = endSegmentIndex;
      lineStartGraphemeIndex = endGraphemeIndex;
    }

    for (var segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      var kind = kinds[segmentIndex];
      var segmentWidth = widths[segmentIndex];

      if (kind === "hardBreak") {
        emitLine(segmentIndex, 0, true);
        lineStartSegmentIndex = segmentIndex + 1;
        lineStartGraphemeIndex = 0;
        continue;
      }

      if (kind === "space") {
        if (!hasContent) {
          continue;
        }

        lineWidth += segmentWidth;
        continue;
      }

      if (hasContent && lineWidth + segmentWidth > limit) {
        emitLine(segmentIndex, 0, false);
        lineStartSegmentIndex = segmentIndex;
        lineStartGraphemeIndex = 0;
      }

      if (!hasContent && segmentWidth > limit) {
        var perGraphemeWidths = graphemeWidths[segmentIndex];
        if (Array.isArray(perGraphemeWidths) && perGraphemeWidths.length > 1 && limit !== Infinity) {
          var chunkWidth = 0;
          var chunkStart = 0;

          for (var graphemeIndex = 0; graphemeIndex < perGraphemeWidths.length; graphemeIndex += 1) {
            var graphemeWidth = perGraphemeWidths[graphemeIndex];

            if (chunkWidth > 0 && chunkWidth + graphemeWidth > limit) {
              lineWidth = chunkWidth;
              hasContent = true;
              lineStartSegmentIndex = segmentIndex;
              lineStartGraphemeIndex = chunkStart;
              emitLine(segmentIndex, graphemeIndex, false);
              chunkStart = graphemeIndex;
              chunkWidth = 0;
            }

            chunkWidth += graphemeWidth;
          }

          lineWidth = chunkWidth;
          hasContent = true;
          lineStartSegmentIndex = segmentIndex;
          lineStartGraphemeIndex = chunkStart;
          continue;
        }
      }

      if (!hasContent) {
        lineStartSegmentIndex = segmentIndex;
        lineStartGraphemeIndex = 0;
      }

      lineWidth += segmentWidth;
      hasContent = true;
    }

    if (hasContent || lineCount === 0) {
      emitLine(segments.length, 0, true);
    }

    return lineCount;
  }

  global.Pretext = {
    clearCache: clearCache,
    prepare: prepareWithSegments,
    prepareWithSegments: prepareWithSegments,
    walkLineRanges: walkLineRanges,
    version: "vendor-menu-bridge",
  };
})(window);
