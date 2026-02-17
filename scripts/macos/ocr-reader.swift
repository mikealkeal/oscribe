#!/usr/bin/env swift
/**
 * ocr-reader - macOS Vision framework OCR reader
 * Usage: ocr-reader "/path/to/screenshot.png"
 * Output: JSON with lines → words hierarchy (same format as Windows ocr-recognize.ps1)
 *
 * Compile: swiftc scripts/macos/ocr-reader.swift -o bin/ocr-reader -framework Vision -framework AppKit
 */

import Vision
import AppKit
import Foundation

struct WordResult: Codable {
    let text: String
    let bounds: Bounds
}

struct LineResult: Codable {
    let text: String
    let bounds: Bounds
    let words: [WordResult]?
}

struct Bounds: Codable {
    let x: Int
    let y: Int
    let width: Int
    let height: Int
}

struct OcrOutput: Codable {
    let lines: [LineResult]
    let language: String?
    let error: String?
}

// MARK: - Main

guard CommandLine.arguments.count >= 2 else {
    let output = OcrOutput(lines: [], language: nil, error: "Usage: ocr-reader <image-path>")
    let data = try! JSONEncoder().encode(output)
    print(String(data: data, encoding: .utf8)!)
    exit(1)
}

let imagePath = CommandLine.arguments[1]

guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    let output = OcrOutput(lines: [], language: nil, error: "Failed to load image: \(imagePath)")
    let data = try! JSONEncoder().encode(output)
    print(String(data: data, encoding: .utf8)!)
    exit(1)
}

let imageWidth = cgImage.width
let imageHeight = cgImage.height

// Set up text recognition request
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

do {
    try handler.perform([request])
} catch {
    let output = OcrOutput(lines: [], language: nil, error: "OCR failed: \(error.localizedDescription)")
    let data = try! JSONEncoder().encode(output)
    print(String(data: data, encoding: .utf8)!)
    exit(1)
}

guard let observations = request.results else {
    let output = OcrOutput(lines: [], language: nil, error: nil)
    let data = try! JSONEncoder().encode(output)
    print(String(data: data, encoding: .utf8)!)
    exit(0)
}

// Vision framework returns coordinates in normalized form (0.0-1.0)
// Origin is bottom-left. Convert to pixel coordinates with top-left origin.
var lineResults: [LineResult] = []

for observation in observations {
    guard let topCandidate = observation.topCandidates(1).first else { continue }

    let lineText = topCandidate.string

    // Get line bounding box (normalized, bottom-left origin)
    let lineBox = observation.boundingBox
    let lineX = Int(lineBox.origin.x * CGFloat(imageWidth))
    let lineY = Int((1.0 - lineBox.origin.y - lineBox.height) * CGFloat(imageHeight))
    let lineW = Int(lineBox.width * CGFloat(imageWidth))
    let lineH = Int(lineBox.height * CGFloat(imageHeight))
    let lineBounds = Bounds(x: lineX, y: lineY, width: lineW, height: lineH)

    // Split line into words and get per-word bounding boxes
    let wordSegments = lineText.split(separator: " ")

    var words: [WordResult] = []
    var searchStart = topCandidate.string.startIndex

    for wordStr in wordSegments {
        if let range = topCandidate.string.range(of: String(wordStr), range: searchStart..<topCandidate.string.endIndex) {
            do {
                if let boxObservation = try topCandidate.boundingBox(for: range) {
                    let wBox = boxObservation.boundingBox
                    let wx = Int(wBox.origin.x * CGFloat(imageWidth))
                    let wy = Int((1.0 - wBox.origin.y - wBox.height) * CGFloat(imageHeight))
                    let ww = Int(wBox.width * CGFloat(imageWidth))
                    let wh = Int(wBox.height * CGFloat(imageHeight))
                    words.append(WordResult(text: String(wordStr), bounds: Bounds(x: wx, y: wy, width: ww, height: wh)))
                } else {
                    // No bounding box available, use line bounds as fallback
                    words.append(WordResult(text: String(wordStr), bounds: lineBounds))
                }
            } catch {
                // Fallback: use line bounds for this word
                words.append(WordResult(text: String(wordStr), bounds: lineBounds))
            }
            searchStart = range.upperBound
        }
    }

    // Only include words array if 2+ words (matches Windows behavior)
    let wordsField: [WordResult]? = words.count > 1 ? words : nil
    lineResults.append(LineResult(text: lineText, bounds: lineBounds, words: wordsField))
}

let output = OcrOutput(lines: lineResults, language: "auto", error: nil)
let encoder = JSONEncoder()
encoder.outputFormatting = [] // compact JSON
let data = try! encoder.encode(output)
print(String(data: data, encoding: .utf8)!)
