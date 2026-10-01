//
//  HTTPCacheControlTests.swift
//  FlyingFox
//
//  Distributed under the permissive MIT license
//  Get the latest version from here:
//
//  https://github.com/swhitty/FlyingFox
//

@testable import FlyingFox
import Foundation
import Testing

struct HTTPCacheControlTests {

    @Test
    func getETagValue_returnsNil_whenFileIsMissing() {
        let missing = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("flyingfox-etag-missing-\(UUID().uuidString)")
        #expect(HTTPCacheControl.getETagValue(for: missing) == nil)
    }

    @Test
    func getETagValue_isStrong_quoted_andHasNoWeakPrefix() throws {
        let url = try Self.makeTempFile(contents: Data("hello".utf8))
        defer { try? FileManager.default.removeItem(at: url) }

        let etag = try #require(HTTPCacheControl.getETagValue(for: url))

        // Strong validator: starts/ends with a literal double quote, no W/ prefix.
        // Matches nginx "<hex-mtime>-<hex-size>" inside double quotes.
        #expect(etag.hasPrefix("\""))
        #expect(etag.hasSuffix("\""))
        #expect(!etag.hasPrefix("W/"))

        let inner = etag.dropFirst().dropLast()
        let parts = inner.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        #expect(parts.count == 2)
        #expect(parts.allSatisfy { Self.isLowerHex($0) })
    }

    @Test
    func getETagValue_isStable_forSameFile() throws {
        let url = try Self.makeTempFile(contents: Data("stable".utf8))
        defer { try? FileManager.default.removeItem(at: url) }

        #expect(HTTPCacheControl.getETagValue(for: url) == HTTPCacheControl.getETagValue(for: url))
    }

    @Test
    func getETagValue_differs_whenSizeDiffers() throws {
        let mtime = Date(timeIntervalSince1970: 1_700_000_000)
        let small = try Self.makeTempFile(contents: Data("a".utf8), modificationDate: mtime)
        defer { try? FileManager.default.removeItem(at: small) }
        let bigger = try Self.makeTempFile(contents: Data("ab".utf8), modificationDate: mtime)
        defer { try? FileManager.default.removeItem(at: bigger) }

        let etagSmall = try #require(HTTPCacheControl.getETagValue(for: small))
        let etagBigger = try #require(HTTPCacheControl.getETagValue(for: bigger))
        #expect(etagSmall != etagBigger)
    }

    @Test
    func getETagValue_differs_whenMtimeDiffers() throws {
        let url = try Self.makeTempFile(
            contents: Data("same-bytes".utf8),
            modificationDate: Date(timeIntervalSince1970: 1_700_000_000)
        )
        defer { try? FileManager.default.removeItem(at: url) }
        let earlier = try #require(HTTPCacheControl.getETagValue(for: url))

        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSince1970: 1_800_000_000)],
            ofItemAtPath: url.path
        )
        let later = try #require(HTTPCacheControl.getETagValue(for: url))

        #expect(earlier != later)
    }

    // The defining behavior of a metadata ETag: equal mtime + equal size → equal ETag,
    // even if the file contents differ. This is exactly the property a SHA-256-of-contents
    // ETag does NOT have.
    @Test
    func getETagValue_collides_whenMtimeAndSizeMatchButContentsDiffer() throws {
        let mtime = Date(timeIntervalSince1970: 1_700_000_000)
        let a = try Self.makeTempFile(contents: Data("AAAAA".utf8), modificationDate: mtime)
        defer { try? FileManager.default.removeItem(at: a) }
        let b = try Self.makeTempFile(contents: Data("BBBBB".utf8), modificationDate: mtime)
        defer { try? FileManager.default.removeItem(at: b) }

        let etagA = try #require(HTTPCacheControl.getETagValue(for: a))
        let etagB = try #require(HTTPCacheControl.getETagValue(for: b))
        #expect(etagA == etagB)
    }

    private static func makeTempFile(
        contents: Data,
        modificationDate: Date? = nil
    ) throws -> URL {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("flyingfox-etag-\(UUID().uuidString)")
        try contents.write(to: url)
        if let modificationDate {
            try FileManager.default.setAttributes(
                [.modificationDate: modificationDate],
                ofItemAtPath: url.path
            )
        }
        return url
    }

    private static func isLowerHex(_ s: Substring) -> Bool {
        !s.isEmpty && s.allSatisfy { $0.isHexDigit && (!$0.isLetter || $0.isLowercase) }
    }
}
