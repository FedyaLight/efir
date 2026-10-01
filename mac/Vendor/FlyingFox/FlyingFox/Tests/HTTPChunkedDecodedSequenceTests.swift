//
//  HTTPChunkedDecodedSequenceTests.swift
//  FlyingFox
//
//  Created by Ian Gordon on 27/04/2026.
//  Copyright © 2026 Simon Whitty. All rights reserved.
//
//  Distributed under the permissive MIT license
//  Get the latest version from here:
//
//  https://github.com/swhitty/FlyingFox
//
//  Permission is hereby granted, free of charge, to any person obtaining a copy
//  of this software and associated documentation files (the "Software"), to deal
//  in the Software without restriction, including without limitation the rights
//  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//  copies of the Software, and to permit persons to whom the Software is
//  furnished to do so, subject to the following conditions:
//
//  The above copyright notice and this permission notice shall be included in all
//  copies or substantial portions of the Software.
//
//  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//  SOFTWARE.
//

@testable import FlyingFox
import FlyingSocks
import Foundation
import Testing

struct HTTPChunkedDecodedSequenceTests {

    // RFC 9112 §7.1 — once the trailer's terminating CRLF is consumed, the
    // decoder must stop. Over-consuming would eat the next pipelined request
    // on a keep-alive connection.
    @Test
    func decoder_DoesNotConsumeBeyondTerminator() async throws {
        let wire: [UInt8] = Array("5\r\nHello\r\n0\r\n\r\nNEXT".utf8)
        let source = ConsumingAsyncSequence(bytes: wire)

        var decoded = [UInt8]()
        var iterator = HTTPChunkedTransferDecoder(bytes: source).makeAsyncIterator()
        while let buffer = try await iterator.nextBuffer(suggested: 1024) {
            decoded.append(contentsOf: buffer)
        }
        #expect(decoded == Array("Hello".utf8))

        var trailing = [UInt8]()
        var sourceIterator = source.makeAsyncIterator()
        while let buffer = try await sourceIterator.nextBuffer(suggested: 1024) {
            trailing.append(contentsOf: buffer)
        }
        #expect(trailing == Array("NEXT".utf8))
    }

    @Test
    func decoder_HonorsSuggestedBufferCount() async throws {
        let payload = String(repeating: "x", count: 100)
        let wire: [UInt8] = Array("64\r\n\(payload)\r\n0\r\n\r\n".utf8)

        var iterator = HTTPChunkedTransferDecoder(
            bytes: ConsumingAsyncSequence(bytes: wire)
        ).makeAsyncIterator()
        var sizes = [Int]()
        while let buffer = try await iterator.nextBuffer(suggested: 16) {
            sizes.append(buffer.count)
        }

        #expect(sizes.allSatisfy { $0 <= 16 })
        #expect(sizes.reduce(0, +) == 100)
    }

    // RFC 9112 §7.1 — `chunk-size = 1*HEXDIG`. Per RFC 5234 §2.3, ABNF literal
    // strings match case-insensitively, so lowercase `a-f` is also valid.
    @Test
    func decoder_AcceptsUppercaseHexChunkSize() async throws {
        let payload = String(repeating: "x", count: 0xFF)
        let wire: [UInt8] = Array("FF\r\n\(payload)\r\n0\r\n\r\n".utf8)

        var iterator = HTTPChunkedTransferDecoder(
            bytes: ConsumingAsyncSequence(bytes: wire)
        ).makeAsyncIterator()
        var decoded = [UInt8]()
        while let buffer = try await iterator.nextBuffer(suggested: 1024) {
            decoded.append(contentsOf: buffer)
        }

        #expect(decoded.count == 0xFF)
    }

    // A chunk-size larger than `Int.max` cannot be represented; `Int(_, radix:)`
    // returns nil and the decoder must reject it as a framing error rather than
    // silently truncating or trapping.
    @Test
    func decoder_RejectsChunkSizeExceedingIntMax() async throws {
        let wire: [UInt8] = Array("FFFFFFFFFFFFFFFFFFFF\r\n".utf8)

        var iterator = HTTPChunkedTransferDecoder(
            bytes: ConsumingAsyncSequence(bytes: wire)
        ).makeAsyncIterator()

        await #expect(throws: HTTPDecoder.Error.self) {
            _ = try await iterator.nextBuffer(suggested: 1024)
        }
    }
}
