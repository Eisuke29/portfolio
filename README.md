# Eisuke Kinoshita Portfolio

制作したWebアプリ・ゲーム・映像・UIのポートフォリオ。

[作品を見る](https://eisuke29.github.io/portfolio/) · [ポートフォリオ](https://eisuke29.github.io/portfolio/)

## 掲載作品

| 作品 | 内容 | リポジトリ |
|---|---|---|
| ScrumCanvas | ラグビーの戦術を3Dで組み立てて再生するシミュレーター。Processing原版とp5.js移植版。 | [scrumcanvas](https://github.com/Eisuke29/scrumcanvas) |
| チャンバラ -RING OUT- | 4人チームで制作した対戦ゲームを、スマホの傾きで遊べる対CPUのWeb版に移植。 | [chambara-ring-out](https://github.com/Eisuke29/chambara-ring-out) |
| CHROMATIC SHIFT | 色を切り替えて箱を消し、道を作るUnity製3Dパズル。 | [chromatic-shift](https://github.com/Eisuke29/chromatic-shift) |
| DriftWalk Theater | 映像と身体感覚を組み合わせるVR体験のビデオプロトタイプ。 | [driftwalk-theater](https://github.com/Eisuke29/driftwalk-theater) |
| UNSPOKEN | 自分の手の合図をキャラクターに教え、言葉を使わずに操作するインタラクション。 | [unspoken](https://github.com/Eisuke29/unspoken) |
| エレベーター | 日常のエレベーターを舞台にした約45秒の短編ホラー映像。 | [elevator](https://github.com/Eisuke29/elevator) |
| みんなの組体操 | カメラで取り込んだ人の形を集めて、積んで、動かすブラウザ作品。 | [kumitaiso](https://github.com/Eisuke29/kumitaiso) |
| McDonald's App Trace | Figmaで制作した、マクドナルド公式アプリの非公式な学習用UIトレース。 | [mcdonalds-app-trace](https://github.com/Eisuke29/mcdonalds-app-trace) |
| Snapmap | 気になる場所をURLから保存し、地図で眺めて共有できるWebアプリ。 | [SnapMap](https://github.com/Eisuke29/SnapMap) |
| ダンス動画の骨格推定 | YOLOv4で人物を検出し、HRNetで17点の骨格を可視化するMATLABプログラム。 | [dance-pose-estimation](https://github.com/Eisuke29/dance-pose-estimation) |

## 構成

- `index.html` / `works.html` / `work1.html`〜`work10.html`：紹介ページ
- `play/`：ブラウザで体験できる作品
- `images/`：スクリーンショット・作品映像
- `css/` / `js/`：共通デザインと操作

静的なHTML・CSS・JavaScriptで構成し、ビルド工程はありません。

## ローカルで動かす

このリポジトリのフォルダで次を実行し、http://localhost:8000/ を開きます。

```sh
python -m http.server 8000
```

## 表示確認

全ページの320〜1920px・横向き、検索・並べ替え・テーマ切替をブラウザで確認しています。スマホ実機、カメラ・センサー・Unity作品のすべての操作を確認したものではありません。


## 制作者・権利

木下瑛介 / Eisuke Kinoshita（[Eisuke29](https://github.com/Eisuke29)）。共同制作・外部素材については上記の説明を参照してください。自作のコード・映像・デザインについて、別途記載のない限り無断での再配布は許諾していません。外部ライブラリ・モデル・フォント等にはそれぞれのライセンスが適用されます。
