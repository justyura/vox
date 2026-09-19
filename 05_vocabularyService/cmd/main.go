package main

import (
	"encoding/csv"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
)

type Entry struct {
	Translation string
	Exchange    string
	Tag         string
	Rank        int
}

type Result struct {
	Word        string `json:"word"`
	Count       int    `json:"count"`
	Rank        int    `json:"rank"`
	Translation string `json:"translation"`
}

type ExtractResponse struct {
	Words []Result `json:"words"`
}

// 启动时加载一次，之后所有请求只读
var dict map[string]Entry

func toInt(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

func isBasic(tag string) bool {
	for _, t := range strings.Fields(tag) {
		switch t {
		case "zk", "gk", "cet4":
			return true
		}
	}
	return false
}

func baseEntry(word string) Entry {
	entry, ok := dict[word]
	if !ok {
		return Entry{}
	}

	base := lemma(entry.Exchange)

	if base != "" {
		if e, ok := dict[base]; ok {
			return e
		}
	}

	return entry
}

func bestRank(bnc, frq string) int {
	a := toInt(bnc)
	b := toInt(frq)

	switch {
	case a == 0:
		return b
	case b == 0:
		return a
	case a < b:
		return a
	default:
		return b
	}
}

// 从 exchange 里找原形。
// 比如：0:try/1:tried/3:tries
// 返回 try
func lemma(exchange string) string {
	parts := strings.Split(exchange, "/")

	for _, part := range parts {
		if strings.HasPrefix(part, "0:") {
			return part[2:]
		}
	}

	return ""
}

// 不使用正则表达式。
// 手动从文本中提取英文单词。
func splitWords(text string) []string {
	var words []string
	var current []rune

	for _, ch := range text {
		isLetter := (ch >= 'a' && ch <= 'z') ||
			(ch >= 'A' && ch <= 'Z')

		isApostrophe := ch == '\'' || ch == '’'

		if isLetter || isApostrophe {
			if ch == '’' {
				ch = '\''
			}

			current = append(current, ch)
			continue
		}

		if len(current) > 0 {
			words = append(words, string(current))
			current = nil
		}
	}

	// 文件最后一个字符可能正好是字母
	if len(current) > 0 {
		words = append(words, string(current))
	}

	return words
}

// 读取 ECDICT，建立 单词 → 词条 的 map
func loadDict(path string) map[string]Entry {
	file, err := os.Open(path)
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()

	reader := csv.NewReader(file)

	// 跳过第一行表头
	if _, err := reader.Read(); err != nil {
		log.Fatal(err)
	}

	d := make(map[string]Entry)

	for {
		rec, err := reader.Read()

		if err == io.EOF {
			break
		}

		if err != nil {
			log.Fatal(err)
		}

		if len(rec) < 11 {
			continue
		}

		word := strings.ToLower(rec[0])

		entry := Entry{
			Translation: rec[3],
			Tag:         rec[7],
			Exchange:    rec[10],
			Rank:        bestRank(rec[8], rec[9]),
		}

		old, exists := d[word]

		if !exists {
			d[word] = entry
			continue
		}

		// 同一个词在 ECDICT 里可能有多条。
		// 优先保留有词频排名的记录。
		if old.Rank == 0 && entry.Rank != 0 {
			d[word] = entry
			continue
		}

		// 两个都有排名时，保留更常见的那个。
		if old.Rank != 0 &&
			entry.Rank != 0 &&
			entry.Rank < old.Rank {
			d[word] = entry
		}
	}

	return d
}

// 从一段文本里找出“可能不会”的词
func extract(text string) []Result {
	// 统计单词
	counts := make(map[string]int)

	for _, word := range splitWords(text) {
		counts[strings.ToLower(word)]++
	}

	// 用空切片而不是 nil，这样没有结果时 JSON 返回 [] 而不是 null
	results := []Result{}

	for word, count := range counts {
		if len(word) == 1 {
			continue
		}

		entry, exists := dict[word]

		if !exists {
			continue
		}

		base := baseEntry(word)

		// 用原形判断是不是基础词
		if isBasic(base.Tag) {
			continue
		}

		// 用原形的词频判断难度
		if base.Rank == 0 || base.Rank < 5000 {
			continue
		}

		results = append(results, Result{
			Word:        word,
			Count:       count,
			Rank:        base.Rank,
			Translation: strings.SplitN(entry.Translation, `\n`, 2)[0],
		})
	}

	sort.Slice(results, func(i, j int) bool {
		// 出现次数越多，越靠前
		if results[i].Count != results[j].Count {
			return results[i].Count > results[j].Count
		}

		// 次数相同，越生僻越靠前
		return results[i].Rank > results[j].Rank
	})

	return results
}

func handleExtract(w http.ResponseWriter, req *http.Request) {
	var body struct {
		Text string `json:"text"`
	}

	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	json.NewEncoder(w).Encode(ExtractResponse{
		Words: extract(body.Text),
	})
}

func main() {
	path := os.Getenv("DICT_PATH")
	if path == "" {
		log.Fatal("DICT_PATH is not set")
	}

	dict = loadDict(path)
	log.Println("dict loaded:", len(dict))

	http.HandleFunc("POST /v1/extract", handleExtract)

	log.Println("listening on :8090")
	log.Fatal(http.ListenAndServe(":8090", nil))
}
