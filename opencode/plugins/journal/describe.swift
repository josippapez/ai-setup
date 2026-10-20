// Reads {"files":[{"path","diff"}]} on stdin, prints one line per file: "<path>\t<description>".
// Uses Apple's on-device model; exits 2 when it is unavailable so the caller falls back.
import Foundation
import FoundationModels

struct File: Decodable { let path: String; let diff: String; let new: Bool? }
struct Input: Decodable { let files: [File] }

@main struct Describe {
  static func main() async {
    guard case .available = SystemLanguageModel.default.availability else { exit(2) }
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard let input = try? JSONDecoder().decode(Input.self, from: data) else { exit(1) }
    for f in input.files {
      let session = LanguageModelSession(instructions: "You summarise one file's diff for a changelog. Reply with one sentence of at most 25 words in the present tense that says what the change does, naming the functions, fields or settings it touches. No preamble, no judgement.")
      let line: String
      do {
        let label = f.new == true ? "\(f.path) (a new file; describe what it is for)" : f.path
        line = try await session.respond(to: "File: \(label)\nDiff:\n\(f.diff)").content
      } catch {
        line = ""
      }
      print("\(f.path)\t\(line.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces))")
    }
  }
}
